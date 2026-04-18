import chokidar from "chokidar";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import type { AgentEvent, EventSink, EventType } from "../schema.js";
import { clampTs, riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";

/**
 * Hermes Agent adapter (NousResearch/hermes-agent).
 *
 * Unlike Claude Code / Codex / OpenClaw which write JSONL session files,
 * hermes persists everything to a single SQLite DB at ~/.hermes/state.db
 * with FTS5 indexing. Schema (from hermes_state.py @ schema version 6):
 *
 *   sessions (id PK, source, user_id, model, parent_session_id,
 *             started_at, ended_at, end_reason, message_count,
 *             tool_call_count, input_tokens, output_tokens,
 *             cache_read_tokens, cache_write_tokens, reasoning_tokens,
 *             actual_cost_usd, estimated_cost_usd, ...)
 *   messages (id PK, session_id FK, role, content, tool_call_id,
 *             tool_calls JSON, tool_name, timestamp REAL, token_count,
 *             finish_reason, reasoning, ...)
 *   messages_fts (virtual FTS5 on content)
 *
 * Strategy: watch the db file + WAL sidecar with chokidar; on any
 * change, poll for new sessions (started_at > last_started) and
 * new messages (id > last_message_id). SQLite WAL mode means readers
 * don't block writers, so polling is safe.
 *
 * Emits:
 *   - session_start  → when a new sessions row appears
 *   - session_end    → when an existing sessions.ended_at flips non-null
 *   - prompt         → messages.role = 'user'
 *   - response       → messages.role = 'assistant' (usage from session totals)
 *   - tool_call      → messages.role = 'tool' or tool_calls non-empty
 *
 * Subagent linkage: sessions.parent_session_id → maps to agentwatch's
 * parentSpawnId convention (first event of a spawned session gets the
 * parent's last known event id stamped).
 *
 * AUR-229.
 */

type Emit = EventSink | ((e: AgentEvent) => void);

export interface HermesMessage {
  id: number;
  session_id: string;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  timestamp: number;
  token_count: number | null;
  finish_reason: string | null;
  reasoning: string | null;
}

export interface HermesSession {
  id: string;
  source: string | null;
  user_id: string | null;
  model: string | null;
  parent_session_id: string | null;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
}

function resolveHermesDbPath(): string {
  // Explicit override wins (useful for tests + non-standard installs).
  const explicit = process.env.HERMES_DB_PATH?.trim();
  if (explicit && explicit.length > 0) return explicit;
  // Match hermes's own convention: HERMES_HOME → $HERMES_HOME/state.db.
  const hermesHome = process.env.HERMES_HOME?.trim();
  const base = hermesHome && hermesHome.length > 0 ? hermesHome : join(homedir(), ".hermes");
  return join(base, "state.db");
}

const DEFAULT_DB_PATH = join(homedir(), ".hermes", "state.db");

export function translateHermesSessionStart(s: HermesSession, source: string): AgentEvent {
  const ts = new Date(Math.floor(s.started_at * 1000)).toISOString();
  return {
    id: nextId(),
    ts: clampTs(ts),
    agent: "hermes",
    type: "session_start",
    sessionId: s.id,
    riskScore: riskOf("session_start"),
    summary: `session ${s.id.slice(0, 8)} (${s.source ?? "unknown"}${s.model ? ", " + s.model : ""})`,
    details: {
      source,
      model: s.model ?? undefined,
      parentSpawnId: s.parent_session_id ?? undefined,
    },
  };
}

export function translateHermesSessionEnd(s: HermesSession, source: string): AgentEvent {
  const endedAtSec = s.ended_at ?? s.started_at;
  const ts = new Date(Math.floor(endedAtSec * 1000)).toISOString();
  return {
    id: nextId(),
    ts: clampTs(ts),
    agent: "hermes",
    type: "session_end",
    sessionId: s.id,
    riskScore: riskOf("session_end"),
    summary: `session ${s.id.slice(0, 8)} ended${s.end_reason ? " (" + s.end_reason + ")" : ""}`,
    details: {
      source,
      model: s.model ?? undefined,
      usage: {
        input: s.input_tokens ?? 0,
        cacheCreate: s.cache_write_tokens ?? 0,
        cacheRead: s.cache_read_tokens ?? 0,
        output: s.output_tokens ?? 0,
      },
      cost: s.actual_cost_usd ?? s.estimated_cost_usd ?? undefined,
    },
  };
}

export function translateHermesMessage(m: HermesMessage, source: string): AgentEvent | null {
  const ts = new Date(Math.floor(m.timestamp * 1000)).toISOString();

  // Tool calls can appear two ways in hermes:
  //   - role='tool' entries (the tool's RESULT row, correlated by tool_call_id)
  //   - role='assistant' entries with tool_calls JSON populated (the REQUEST)
  // We emit tool_call for the assistant request and drop the tool-result rows —
  // agentwatch pairs tool_call → tool_result by toolUseId elsewhere.
  let type: EventType;
  let toolInput: Record<string, unknown> | undefined;
  let toolName: string | undefined;
  if (m.role === "user") {
    type = "prompt";
  } else if (m.role === "assistant") {
    if (m.tool_calls) {
      type = "tool_call";
      try {
        const parsed = JSON.parse(m.tool_calls);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const first = parsed[0] as { function?: { name?: string; arguments?: string }; name?: string };
          toolName = first.function?.name ?? first.name ?? "tool";
          const argsStr = first.function?.arguments;
          if (argsStr) {
            try {
              toolInput = JSON.parse(argsStr);
            } catch {
              toolInput = { raw: argsStr };
            }
          }
        }
      } catch {
        // tool_calls wasn't JSON — leave toolInput undefined
      }
    } else {
      type = "response";
    }
  } else if (m.role === "tool" || m.role === "function") {
    return null;
  } else if (m.role === "system") {
    return null;
  } else {
    type = "prompt";
  }

  return {
    id: nextId(),
    ts: clampTs(ts),
    agent: "hermes",
    type,
    sessionId: m.session_id,
    tool: toolName,
    riskScore: riskOf(type),
    summary: hermesSummaryFor(type, m, toolName),
    details: {
      source,
      fullText: m.content ?? undefined,
      thinking: m.reasoning ?? undefined,
      toolInput,
      toolUseId: m.tool_call_id ?? undefined,
    },
  };
}

function hermesSummaryFor(type: EventType, m: HermesMessage, toolName?: string): string | undefined {
  if (type === "tool_call") return toolName ? `${toolName}(…)` : "tool_call";
  if (!m.content) return undefined;
  const oneline = m.content.replace(/\s+/g, " ").trim();
  if (oneline.length <= 140) return oneline;
  return oneline.slice(0, 137) + "...";
}

export function startHermesAdapter(sink: Emit): () => void {
  const emit = typeof sink === "function" ? sink : sink.emit;
  const dbPath = resolveHermesDbPath();

  // Hermes isn't installed → silent no-op (same convention as openclaw
  // when ~/.openclaw doesn't exist).
  if (!existsSync(dbPath)) return () => {};

  let db: DB | null = null;
  let lastMessageId = 0;
  const seenSessionIds = new Set<string>();
  const openSessionIds = new Set<string>();
  let closed = false;

  function openDb(): DB | null {
    try {
      const d = new Database(dbPath, { readonly: true, fileMustExist: true });
      d.pragma("journal_mode = WAL");
      d.pragma("busy_timeout = 2000");
      return d;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[agentwatch] hermes adapter: cannot open db:", err);
      return null;
    }
  }

  function bootstrap(): void {
    if (!db) return;
    try {
      // Backfill the most recent N messages so the UI shows hermes
      // history on boot, same as claude-code/codex/gemini adapters do.
      // 2000 is enough to cover recent activity without flooding the
      // ring buffer.
      const HERMES_BACKFILL = 2_000;
      const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS mx FROM messages").get() as { mx: number } | undefined;
      const maxId = row?.mx ?? 0;
      lastMessageId = Math.max(0, maxId - HERMES_BACKFILL);
      // Don't pre-seed seenSessionIds — let the first poll emit
      // session_start for each so they show up in the timeline too.
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[agentwatch] hermes bootstrap failed:", err);
    }
  }

  function pollAndEmit(): void {
    if (!db || closed) return;

    try {
      const newSessions = db
        .prepare(
          "SELECT id, source, user_id, model, parent_session_id, started_at, ended_at, end_reason, " +
            "input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, " +
            "actual_cost_usd, estimated_cost_usd " +
            "FROM sessions",
        )
        .all() as HermesSession[];

      for (const s of newSessions) {
        if (!seenSessionIds.has(s.id)) {
          seenSessionIds.add(s.id);
          emit(translateHermesSessionStart(s, dbPath));
          if (s.ended_at === null) openSessionIds.add(s.id);
          else emit(translateHermesSessionEnd(s, dbPath));
        } else if (openSessionIds.has(s.id) && s.ended_at !== null) {
          openSessionIds.delete(s.id);
          emit(translateHermesSessionEnd(s, dbPath));
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[agentwatch] hermes sessions poll failed:", err);
    }

    try {
      const rows = db
        .prepare(
          "SELECT id, session_id, role, content, tool_call_id, tool_calls, tool_name, " +
            "timestamp, token_count, finish_reason, reasoning " +
            "FROM messages WHERE id > ? ORDER BY id LIMIT 500",
        )
        .all(lastMessageId) as HermesMessage[];

      for (const m of rows) {
        lastMessageId = Math.max(lastMessageId, m.id);
        const evt = translateHermesMessage(m, dbPath);
        if (evt) emit(evt);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[agentwatch] hermes messages poll failed:", err);
    }
  }

  db = openDb();
  if (!db) return () => {};
  bootstrap();

  pollAndEmit();

  // Watch the db + WAL sidecar. No awaitWriteFinish — we're polling SQLite,
  // not reading file bytes, so we don't need the file to be "stable" before
  // firing. fsevents is also slow for SQLite WAL writes (the main .db
  // mtime only moves on checkpoint), so the 2s safety-net poll below is
  // the real latency ceiling users see.
  const watchPaths = [dbPath, dbPath + "-wal"];
  const watcher = chokidar.watch(watchPaths, { ignoreInitial: true });
  watcher.on("change", () => pollAndEmit());
  watcher.on("add", () => pollAndEmit());

  const poller = setInterval(() => pollAndEmit(), 2_000);

  return (): void => {
    closed = true;
    clearInterval(poller);
    try {
      watcher.close();
    } catch {
      // chokidar close errors are non-fatal
    }
    if (db) {
      try {
        db.close();
      } catch {
        // better-sqlite3 close errors are non-fatal
      }
      db = null;
    }
  };
}

// Exported for tests.
export const _HERMES_INTERNAL = {
  DEFAULT_DB_PATH,
};
