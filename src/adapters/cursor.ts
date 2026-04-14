import chokidar from "chokidar";
import { readFileSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, EventType } from "../schema.js";
import { riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";

type Emit = (e: AgentEvent) => void;

/**
 * Cursor adapter — config-level only in v0.
 *
 * Cursor's live activity is partially exposed through a SQLite DB
 * (`~/.cursor/ai-tracking/ai-code-tracking.db`) which requires additional
 * dependencies to parse. For v0 we watch the JSON/text config surface:
 *   - mcp.json         (MCP server list)
 *   - cli-config.json  (permissions, approval mode, sandbox)
 *   - ide_state.json   (recently viewed files — real activity signal)
 *   - project-level .cursorrules files in the workspace
 */
export function startCursorAdapter(workspace: string, emit: Emit): () => void {
  const cursorDir = join(homedir(), ".cursor");
  if (!existsSync(cursorDir)) return () => {};

  const stoppers: Array<() => void> = [];
  const lastRecentFiles = new Set<string>();

  const emitEvent = (
    type: EventType,
    summary: string,
    opts: Partial<AgentEvent> = {},
  ) => {
    emit({
      id: nextId(),
      ts: new Date().toISOString(),
      agent: "cursor",
      type,
      tool: "cursor",
      summary,
      riskScore: riskOf(type, opts.path, opts.cmd),
      ...opts,
    });
  };

  // 1) Config files in ~/.cursor/
  const configPaths = [
    join(cursorDir, "mcp.json"),
    join(cursorDir, "cli-config.json"),
  ];
  for (const path of configPaths) {
    if (!existsSync(path)) continue;
    const w = chokidar.watch(path, { persistent: true, ignoreInitial: false });
    w.on("add", () => announceConfig(path, "detected", emitEvent));
    w.on("change", () => announceConfig(path, "changed", emitEvent));
    stoppers.push(() => w.close());
  }

  // 2) ide_state.json — recently viewed files. This is the richest local signal
  //    Cursor exposes without touching the SQLite tracking DB.
  const stateFile = join(cursorDir, "ide_state.json");
  if (existsSync(stateFile)) {
    const w = chokidar.watch(stateFile, {
      persistent: true,
      ignoreInitial: true,
    });
    const handler = () => {
      const recent = readRecentFiles(stateFile);
      for (const path of recent) {
        if (lastRecentFiles.has(path)) continue;
        lastRecentFiles.add(path);
        emitEvent("file_read", path, {
          tool: "cursor:ide_state",
          path,
        });
      }
    };
    // seed from initial state so we don't re-emit history on first change
    for (const p of readRecentFiles(stateFile)) lastRecentFiles.add(p);
    w.on("change", handler);
    stoppers.push(() => w.close());
  }

  // 3) project-level .cursorrules anywhere under the workspace
  const rulesWatcher = chokidar.watch(workspace, {
    persistent: true,
    ignoreInitial: false,
    depth: 3,
    ignored: (p) => {
      if (/(^|[/\\])node_modules[/\\]/.test(p)) return true;
      if (/(^|[/\\])\.git[/\\]/.test(p)) return true;
      if (/(^|[/\\])dist[/\\]/.test(p)) return true;
      return false;
    },
  });
  const isRules = (f: string) => /(^|[/\\])\.cursorrules$/.test(f);
  rulesWatcher.on("add", (f) => {
    if (!isRules(f)) return;
    emitEvent("file_read", `.cursorrules discovered: ${f}`, {
      tool: "cursor:rules",
      path: f,
    });
  });
  rulesWatcher.on("change", (f) => {
    if (!isRules(f)) return;
    emitEvent("file_write", `.cursorrules edited: ${f}`, {
      tool: "cursor:rules",
      path: f,
    });
  });
  stoppers.push(() => rulesWatcher.close());

  return () => {
    for (const s of stoppers) s();
  };
}

function announceConfig(
  path: string,
  action: "detected" | "changed",
  emitEvent: (t: EventType, s: string, opts?: Partial<AgentEvent>) => void,
) {
  const summary = summarizeConfig(path, action);
  const type: EventType = action === "changed" ? "file_write" : "tool_call";
  emitEvent(type, summary, { path, tool: `cursor:${configName(path)}` });
}

function configName(path: string): string {
  if (path.endsWith("mcp.json")) return "mcp";
  if (path.endsWith("cli-config.json")) return "permissions";
  return "config";
}

function summarizeConfig(path: string, action: "detected" | "changed"): string {
  try {
    const raw = readFileSync(path, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (path.endsWith("mcp.json")) {
      const servers = Object.keys(
        (obj.mcpServers ?? {}) as Record<string, unknown>,
      );
      return `Cursor MCP ${action}: ${servers.length} server${servers.length === 1 ? "" : "s"} (${servers.join(", ") || "none"})`;
    }
    if (path.endsWith("cli-config.json")) {
      const perms = (obj.permissions ?? {}) as Record<string, unknown>;
      const allow = Array.isArray(perms.allow) ? perms.allow.length : 0;
      const deny = Array.isArray(perms.deny) ? perms.deny.length : 0;
      const mode = obj.approvalMode ?? "unknown";
      const sandbox = (obj.sandbox as Record<string, unknown> | undefined)?.mode;
      return `Cursor permissions ${action}: mode=${mode}, sandbox=${sandbox ?? "?"}, allow=${allow}, deny=${deny}`;
    }
    return `Cursor config ${action}: ${path}`;
  } catch {
    return `Cursor config ${action}: ${path}`;
  }
}

function readRecentFiles(stateFile: string): string[] {
  try {
    const raw = readFileSync(stateFile, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const list = obj.recentlyViewedFiles;
    if (!Array.isArray(list)) return [];
    return list
      .map((r: unknown) => {
        if (typeof r !== "object" || r === null) return undefined;
        const rec = r as Record<string, unknown>;
        if (typeof rec.absolutePath === "string") return rec.absolutePath;
        if (typeof rec.relativePath === "string") return rec.relativePath;
        return undefined;
      })
      .filter((x): x is string => typeof x === "string")
      .slice(0, 20);
  } catch {
    return [];
  }
}

// keep statSync import active for future last-modified use
void statSync;
