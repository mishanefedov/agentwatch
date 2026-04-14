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

export interface CursorStatus {
  installed: boolean;
  mcpServers: string[];
  permissions?: {
    approvalMode: string;
    sandboxMode: string;
    allowCount: number;
    denyCount: number;
  };
  cursorRulesFiles: string[];
}

/**
 * Cursor adapter — config-level only in v0.
 *
 * Startup work is side-effect-free: we read the config and return a
 * synchronous status snapshot for the agent panel. No events emitted on
 * startup — only when files actually change. That keeps the timeline
 * reserved for real activity.
 */
export function startCursorAdapter(
  workspace: string,
  emit: Emit,
): { stop: () => void; status: CursorStatus } {
  const cursorDir = join(homedir(), ".cursor");
  const installed = existsSync(cursorDir);
  const status: CursorStatus = {
    installed,
    mcpServers: [],
    cursorRulesFiles: [],
  };
  if (!installed) return { stop: () => {}, status };

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

  // 1) MCP config — read snapshot, watch for changes only
  const mcpPath = join(cursorDir, "mcp.json");
  if (existsSync(mcpPath)) {
    status.mcpServers = readMcpServers(mcpPath);
    const w = chokidar.watch(mcpPath, {
      persistent: true,
      ignoreInitial: true,
    });
    w.on("change", () => {
      status.mcpServers = readMcpServers(mcpPath);
      emitEvent(
        "file_write",
        `Cursor MCP changed: ${status.mcpServers.length} server(s) (${status.mcpServers.join(", ") || "none"})`,
        { path: mcpPath, tool: "cursor:mcp" },
      );
    });
    w.on("error", swallow);
    stoppers.push(() => {
      void w.close();
    });
  }

  // 2) Permissions (cli-config.json) — snapshot + watch for changes
  const permPath = join(cursorDir, "cli-config.json");
  if (existsSync(permPath)) {
    status.permissions = readPermissions(permPath);
    const w = chokidar.watch(permPath, {
      persistent: true,
      ignoreInitial: true,
    });
    w.on("change", () => {
      status.permissions = readPermissions(permPath);
      const p = status.permissions;
      emitEvent(
        "file_write",
        `Cursor permissions changed: mode=${p?.approvalMode}, sandbox=${p?.sandboxMode}, allow=${p?.allowCount}, deny=${p?.denyCount}`,
        { path: permPath, tool: "cursor:permissions" },
      );
    });
    w.on("error", swallow);
    stoppers.push(() => {
      void w.close();
    });
  }

  // 3) ide_state.json — recently viewed files. Live signal only.
  const stateFile = join(cursorDir, "ide_state.json");
  if (existsSync(stateFile)) {
    for (const p of readRecentFiles(stateFile)) lastRecentFiles.add(p);
    const w = chokidar.watch(stateFile, {
      persistent: true,
      ignoreInitial: true,
    });
    w.on("change", () => {
      const recent = readRecentFiles(stateFile);
      for (const path of recent) {
        if (lastRecentFiles.has(path)) continue;
        lastRecentFiles.add(path);
        const project = extractProject(path);
        emitEvent("file_read", project ? `[${project}] ${path}` : path, {
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

  // 4) .cursorrules — one-shot shallow discovery + per-file watch
  //    (no workspace-wide recursive watcher — blows fd limit on large trees)
  const rulesFiles = discoverCursorrules(workspace);
  status.cursorRulesFiles = rulesFiles;
  for (const path of rulesFiles) {
    const w = chokidar.watch(path, {
      persistent: true,
      ignoreInitial: true,
    });
    w.on("change", () => {
      const project = extractProject(path);
      emitEvent(
        "file_write",
        `${project ? `[${project}] ` : ""}.cursorrules edited`,
        { tool: "cursor:rules", path },
      );
    });
    w.on("error", swallow);
    stoppers.push(() => {
      void w.close();
    });
  }

  return {
    stop: () => {
      for (const s of stoppers) s();
    },
    status,
  };
}

function swallow(err: unknown): void {
  if (typeof err !== "object" || err === null) return;
  const code = (err as { code?: string }).code;
  if (code === "EMFILE" || code === "ENOSPC" || code === "EACCES") return;
  // eslint-disable-next-line no-console
  console.error("[agentwatch/cursor]", String(err));
}

function readMcpServers(path: string): string[] {
  try {
    const obj = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return Object.keys((obj.mcpServers ?? {}) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function readPermissions(path: string): CursorStatus["permissions"] {
  try {
    const obj = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const perms = (obj.permissions ?? {}) as Record<string, unknown>;
    const sandbox = (obj.sandbox as Record<string, unknown> | undefined)?.mode;
    return {
      approvalMode: String(obj.approvalMode ?? "unknown"),
      sandboxMode: String(sandbox ?? "unknown"),
      allowCount: Array.isArray(perms.allow) ? perms.allow.length : 0,
      denyCount: Array.isArray(perms.deny) ? perms.deny.length : 0,
    };
  } catch {
    return undefined;
  }
}

function readRecentFiles(stateFile: string): string[] {
  try {
    const obj = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
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

function extractProject(path: string): string {
  const segs = path.split("/").filter(Boolean);
  const ideaIdx = segs.indexOf("IdeaProjects");
  if (ideaIdx >= 0 && segs[ideaIdx + 1]) return segs[ideaIdx + 1]!;
  return segs[segs.length - 2] ?? "";
}
