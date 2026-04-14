import chokidar from "chokidar";
import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, EventType } from "../schema.js";
import { riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";

type Emit = (e: AgentEvent) => void;

/**
 * Cursor adapter — config-level only in v0.
 *
 * Intentionally avoids watching the full workspace recursively (that was an
 * EMFILE hazard). Strategy:
 *   - Watch known singletons under ~/.cursor/ (mcp.json, cli-config.json,
 *     ide_state.json)
 *   - One-shot scan of the workspace's top two directory levels for
 *     .cursorrules files, then watch each found file individually.
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

  // 1) Singletons under ~/.cursor/
  const singletons = [
    join(cursorDir, "mcp.json"),
    join(cursorDir, "cli-config.json"),
  ];
  for (const path of singletons) {
    if (!existsSync(path)) continue;
    const w = chokidar.watch(path, {
      persistent: true,
      ignoreInitial: false,
    });
    w.on("add", () => announceConfig(path, "detected", emitEvent));
    w.on("change", () => announceConfig(path, "changed", emitEvent));
    w.on("error", swallow);
    stoppers.push(() => {
      void w.close();
    });
  }

  // 2) ide_state.json — recently viewed files (rolling dedup)
  const stateFile = join(cursorDir, "ide_state.json");
  if (existsSync(stateFile)) {
    const w = chokidar.watch(stateFile, {
      persistent: true,
      ignoreInitial: true,
    });
    for (const p of readRecentFiles(stateFile)) lastRecentFiles.add(p);
    w.on("change", () => {
      const recent = readRecentFiles(stateFile);
      for (const path of recent) {
        if (lastRecentFiles.has(path)) continue;
        lastRecentFiles.add(path);
        emitEvent("file_read", path, {
          tool: "cursor:ide_state",
          path,
        });
      }
    });
    w.on("error", swallow);
    stoppers.push(() => {
      void w.close();
    });
  }

  // 3) .cursorrules — one-shot discovery at shallow depth, then watch
  //    each found file. No recursive workspace watcher — that blew the
  //    macOS FD limit on large workspaces.
  const rulesFiles = discoverCursorrules(workspace);
  for (const path of rulesFiles) {
    emitEvent("file_read", `.cursorrules discovered: ${path}`, {
      tool: "cursor:rules",
      path,
    });
    const w = chokidar.watch(path, {
      persistent: true,
      ignoreInitial: true,
    });
    w.on("change", () => {
      emitEvent("file_write", `.cursorrules edited: ${path}`, {
        tool: "cursor:rules",
        path,
      });
    });
    w.on("error", swallow);
    stoppers.push(() => {
      void w.close();
    });
  }

  return () => {
    for (const s of stoppers) s();
  };
}

function swallow(err: unknown): void {
  if (typeof err !== "object" || err === null) return;
  const code = (err as { code?: string }).code;
  if (code === "EMFILE" || code === "ENOSPC" || code === "EACCES") return;
  // eslint-disable-next-line no-console
  console.error("[agentwatch/cursor]", String(err));
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

/** Shallow scan — workspace root + one level of sub-directories. */
function discoverCursorrules(workspace: string): string[] {
  const hits: string[] = [];
  if (!existsSync(workspace)) return hits;

  const rootRules = join(workspace, ".cursorrules");
  if (existsSync(rootRules)) hits.push(rootRules);

  let entries: string[] = [];
  try {
    entries = readdirSync(workspace);
  } catch {
    return hits;
  }

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (name === "node_modules") continue;
    const dir = join(workspace, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const candidate = join(dir, ".cursorrules");
    if (existsSync(candidate)) hits.push(candidate);
  }
  return hits;
}
