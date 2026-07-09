import chokidar from "chokidar";
import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import type { AgentEvent, EventType, EventSink } from "../schema.js";
import { clampTs, riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";

type Emit = EventSink | ((e: AgentEvent) => void);

/**
 * Cursor SQLite activity (composer sessions + prompts).
 *
 * Cursor (a VS Code fork) persists per-workspace state in a VS Code-style
 * `state.vscdb` — a SQLite db with a single `ItemTable(key TEXT, value)`
 * table. Two keys carry real AI activity:
 *
 *   composer.composerData  → { allComposers: [{ composerId, createdAt,
 *                              totalLinesAdded, totalLinesRemoved,
 *                              isArchived, ... }] } (or a bare array in
 *                              older builds — we accept both)
 *   aiService.prompts      → [{ text, commandType }, ...] — a flat,
 *                              append-only history of user prompts with
 *                              NO per-prompt timestamp and no link back to
 *                              a composerId.
 *
 * What we emit (issue #2 / AUR-187 Gap 3):
 *   - One `session_start` per composerData entry, timestamped at its
 *     `createdAt`, carrying totalLinesAdded/Removed in `linesChanged`.
 *   - One `prompt` per NEW entry appended to aiService.prompts, anchored
 *     to the most-recently-created composer's `createdAt` — "rough but
 *     real": there is no ground truth linking a given prompt to a given
 *     composer or wall-clock time, so we anchor to the newest session as
 *     the best available approximation.
 *
 * What we do NOT emit, because Cursor doesn't persist it to disk at all
 * (confirmed by inspecting a live workspace — see docs/features/
 * agent-detection.md): tool_call / tool_result, per-turn token usage, or
 * cost. That data appears to live server-side only.
 */

export interface CursorComposerEntry {
  composerId: string;
  createdAt: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  isArchived: boolean;
}

export interface CursorPromptEntry {
  text: string;
  commandType?: number;
}

/** Explicit overrides (`CURSOR_DIR`, `CURSOR_WORKSPACE_STORAGE_DIR`) win —
 *  useful for tests and non-standard installs, same convention as the
 *  hermes adapter's `HERMES_DB_PATH`. */
export function resolveCursorDir(): string {
  const explicit = process.env.CURSOR_DIR?.trim();
  if (explicit && explicit.length > 0) return explicit;
  return join(homedir(), ".cursor");
}

export function resolveCursorWorkspaceStorageRoot(): string {
  const explicit = process.env.CURSOR_WORKSPACE_STORAGE_DIR?.trim();
  if (explicit && explicit.length > 0) return explicit;
  const home = homedir();
  return platform() === "darwin"
    ? join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage")
    : join(home, ".config", "Cursor", "User", "workspaceStorage");
}

export function findCursorStateDbs(root: string): string[] {
  if (!existsSync(root)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const hits: string[] = [];
  for (const name of entries) {
    const dbPath = join(root, name, "state.vscdb");
    if (existsSync(dbPath)) hits.push(dbPath);
  }
  return hits;
}

function valueToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

export function parseCursorComposerEntries(text: string): CursorComposerEntry[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown> | null)?.allComposers)
        ? ((parsed as Record<string, unknown>).allComposers as unknown[])
        : [];
    const out: CursorComposerEntry[] = [];
    for (const c of arr) {
      if (!c || typeof c !== "object") continue;
      const rec = c as Record<string, unknown>;
      const composerId = typeof rec.composerId === "string" ? rec.composerId : undefined;
      const createdAt = typeof rec.createdAt === "number" ? rec.createdAt : undefined;
      if (!composerId || createdAt === undefined) continue;
      out.push({
        composerId,
        createdAt,
        totalLinesAdded: typeof rec.totalLinesAdded === "number" ? rec.totalLinesAdded : 0,
        totalLinesRemoved: typeof rec.totalLinesRemoved === "number" ? rec.totalLinesRemoved : 0,
        isArchived: rec.isArchived === true,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function parseCursorPromptEntries(text: string): CursorPromptEntry[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CursorPromptEntry[] = [];
    for (const p of parsed) {
      if (!p || typeof p !== "object") continue;
      const rec = p as Record<string, unknown>;
      if (typeof rec.text !== "string" || rec.text.length === 0) continue;
      out.push({
        text: rec.text,
        commandType: typeof rec.commandType === "number" ? rec.commandType : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function oneLineSummary(text: string, max = 140): string {
  const oneline = text.replace(/\s+/g, " ").trim();
  if (oneline.length <= max) return oneline;
  return oneline.slice(0, max - 3) + "...";
}

export function translateCursorComposer(entry: CursorComposerEntry, source: string): AgentEvent {
  const ts = clampTs(new Date(entry.createdAt).toISOString());
  const archivedTag = entry.isArchived ? " [archived]" : "";
  return {
    id: nextId(),
    ts,
    agent: "cursor",
    type: "session_start",
    sessionId: entry.composerId,
    tool: "cursor:composer",
    riskScore: riskOf("session_start"),
    summary:
      `composer session ${entry.composerId.slice(0, 8)} ` +
      `(+${entry.totalLinesAdded}/-${entry.totalLinesRemoved} lines)${archivedTag}`,
    details: {
      source,
      linesChanged: { added: entry.totalLinesAdded, removed: entry.totalLinesRemoved },
    },
  };
}

export function translateCursorPrompt(
  prompt: CursorPromptEntry,
  anchor: CursorComposerEntry,
  source: string,
): AgentEvent {
  const ts = clampTs(new Date(anchor.createdAt).toISOString());
  return {
    id: nextId(),
    ts,
    agent: "cursor",
    type: "prompt",
    sessionId: anchor.composerId,
    tool: "cursor:prompt",
    riskScore: riskOf("prompt"),
    summary: oneLineSummary(prompt.text),
    details: {
      source,
      fullText: prompt.text,
    },
  };
}

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
 * Cursor adapter — config surface (MCP / permissions / rules / recent
 * files) plus real activity read from Cursor's own SQLite state
 * (composer sessions + prompts; see the doc comment above
 * translateCursorComposer for what that does and doesn't cover).
 *
 * Config-surface startup work is side-effect-free: we read the config and
 * return a synchronous status snapshot for the agent panel, only emitting
 * on subsequent file changes. The SQLite activity block below does emit
 * on startup (backfilling composer sessions + prompts already on disk),
 * matching the other activity adapters (hermes, claude-code, ...).
 */
export function startCursorAdapter(
  workspace: string,
  sink: Emit,
): { stop: () => void; status: CursorStatus } {
  const emit = typeof sink === "function" ? sink : sink.emit;
  const cursorDir = resolveCursorDir();
  const installed = existsSync(cursorDir);
  const status: CursorStatus = {
    installed,
    mcpServers: [],
    cursorRulesFiles: [],
  };
  // The CLI config dir (~/.cursor) and the GUI app's activity DB
  // (workspaceStorage/*/state.vscdb) are independent — a GUI-only user
  // may have real activity with no ~/.cursor at all. Only bail out when
  // BOTH are absent; otherwise run whichever surface is actually there.
  const activityRoot = resolveCursorWorkspaceStorageRoot();
  const activityDbs = findCursorStateDbs(activityRoot);
  if (!installed && activityDbs.length === 0) return { stop: () => {}, status };

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

  // 5) SQLite activity — composer sessions + prompts from every
  //    workspaceStorage/*/state.vscdb on this machine (not scoped to the
  //    current `workspace`, same as the claude-code/hermes adapters
  //    scanning globally under $HOME — agentwatch's whole premise is one
  //    cross-project timeline).
  const dbHandles = new Map<string, DB>();
  const seenComposerIds = new Map<string, Set<string>>();
  const promptsEmitted = new Map<string, number>();
  const watchedDbPaths = new Set<string>();
  const activityWatchers: Array<ReturnType<typeof chokidar.watch>> = [];

  function openCursorDb(dbPath: string): DB | null {
    try {
      const d = new Database(dbPath, { readonly: true, fileMustExist: true });
      d.pragma("busy_timeout = 2000");
      return d;
    } catch {
      return null;
    }
  }

  function processCursorDb(dbPath: string): void {
    let db = dbHandles.get(dbPath);
    if (!db) {
      const opened = openCursorDb(dbPath);
      if (!opened) return;
      db = opened;
      dbHandles.set(dbPath, db);
      seenComposerIds.set(dbPath, new Set());
      promptsEmitted.set(dbPath, 0);
    }

    let composerRow: { value: unknown } | undefined;
    let promptsRow: { value: unknown } | undefined;
    try {
      composerRow = db
        .prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'")
        .get() as { value: unknown } | undefined;
      promptsRow = db
        .prepare("SELECT value FROM ItemTable WHERE key = 'aiService.prompts'")
        .get() as { value: unknown } | undefined;
    } catch (err) {
      swallow(err);
      return;
    }

    const composers = composerRow
      ? parseCursorComposerEntries(valueToText(composerRow.value))
      : [];
    const seen = seenComposerIds.get(dbPath)!;
    for (const c of composers) {
      if (seen.has(c.composerId)) continue;
      seen.add(c.composerId);
      emit(translateCursorComposer(c, dbPath));
    }

    // No composer entries → no timestamp to anchor prompts to. Rather
    // than invent one, skip (documented limitation).
    if (composers.length === 0) return;

    const anchor = composers.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const prompts = promptsRow ? parseCursorPromptEntries(valueToText(promptsRow.value)) : [];
    const alreadyEmitted = promptsEmitted.get(dbPath) ?? 0;
    if (prompts.length > alreadyEmitted) {
      for (let i = alreadyEmitted; i < prompts.length; i++) {
        emit(translateCursorPrompt(prompts[i]!, anchor, dbPath));
      }
    }
    // Array can only be read as a whole (no per-row id), so a shrink
    // (history cleared) just resyncs the count — no replay.
    promptsEmitted.set(dbPath, prompts.length);
  }

  function watchCursorDb(dbPath: string): void {
    if (watchedDbPaths.has(dbPath)) return;
    watchedDbPaths.add(dbPath);
    const w = chokidar.watch([dbPath, dbPath + "-wal"], { ignoreInitial: true });
    w.on("change", () => processCursorDb(dbPath));
    w.on("error", swallow);
    activityWatchers.push(w);
  }

  function rescanWorkspaceStorage(): void {
    for (const dbPath of findCursorStateDbs(activityRoot)) {
      processCursorDb(dbPath);
      watchCursorDb(dbPath);
    }
  }

  rescanWorkspaceStorage();
  // Safety-net poll: catches new workspaces opened in Cursor after
  // agentwatch started, and re-reads content for known dbs in case a
  // write raced the chokidar watcher's startup (same 2s cadence as the
  // hermes adapter's poller, for the same reason).
  const rescanInterval = setInterval(rescanWorkspaceStorage, 2_000);

  stoppers.push(() => {
    clearInterval(rescanInterval);
    for (const w of activityWatchers) void w.close();
    for (const db of dbHandles.values()) {
      try {
        db.close();
      } catch {
        // better-sqlite3 close errors are non-fatal
      }
    }
  });

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
