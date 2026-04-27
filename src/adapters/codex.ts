import chokidar from "chokidar";
import { existsSync, statSync } from "node:fs";
import { basename, join, sep } from "node:path";
import os from "node:os";
import type { AgentEvent, EventSink, EventType } from "../schema.js";
import { clampTs, riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";
import { costOf } from "../util/cost.js";
import { consumeSpawn } from "../util/spawn-tracker.js";
import { readNewlineTerminatedLines } from "../util/jsonl-stream.js";
import { createParseErrorTracker } from "../util/parse-errors.js";

const BACKFILL_BYTES = 4 * 1024 * 1024;

export function codexSessionsDir(home: string = os.homedir()): string {
  return join(home, ".codex", "sessions");
}

interface Cursor {
  offset: number;
  project: string;
  /** cwd captured from session_meta — used for AUR-200 spawn linking. */
  cwd?: string;
  /** Model captured from session_meta / turn_context lines. */
  model?: string;
  /** Event id of the most recently emitted assistant response. */
  lastResponseId?: string;
  /** Usage last attributed to this cursor — dedup key. */
  lastUsageKey?: string;
  /** Pending tool_use events waiting for their function_call_output,
   *  keyed by call_id. Bounded to prevent leaks on malformed sessions. */
  pendingCalls: Map<string, { eventId: string; startMs: number }>;
  /** Parent agent_call event id, if this Codex session was spawned by
   *  another agent (Claude's `Bash(codex exec ...)`). Set on session_meta
   *  via consumeSpawn(); attached to the next emitted event as
   *  details.parentSpawnId, then cleared. */
  pendingParentSpawnId?: string;
}

const MAX_PENDING = 2000;

export function startCodexAdapter(sink: EventSink): () => void {
  const dir = codexSessionsDir();
  if (!existsSync(dir)) return () => {};

  const parseErrors = createParseErrorTracker("codex", sink);
  const cursors = new Map<string, Cursor>();
  const rolloutRe = /rollout-[^/\\]+\.jsonl$/;
  const watcher = chokidar.watch(dir, {
    persistent: true,
    ignoreInitial: false,
    depth: 5,
  });

  const handle = (file: string, isInitialAdd: boolean) => {
    if (!rolloutRe.test(file)) return;
    const size = safeSize(file);
    let cursor = cursors.get(file);
    if (!cursor) {
      const start = isInitialAdd ? Math.max(0, size - BACKFILL_BYTES) : size;
      cursor = {
        offset: start,
        project: "",
        pendingCalls: new Map(),
      };
      cursors.set(file, cursor);
    }
    if (size <= cursor.offset) return;

    const start = cursor.offset;
    const sessionId = extractSessionId(file);
    const { lines, consumed } = readNewlineTerminatedLines(
      file,
      start,
      size - 1,
    );
    cursor.offset = start + consumed;

    for (let i = 0; i < lines.length; i++) {
      if (i === 0 && isInitialAdd && start > 0) continue;
      const line = lines[i]!;
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        parseErrors.recordFailure(sessionId, line);
        continue;
      }
      const payload = (obj.payload ?? {}) as Record<string, unknown>;
      if (obj.type === "session_meta") {
        const cwd = payload.cwd;
        if (typeof cwd === "string") {
          cursor.project = projectOf(cwd);
          cursor.cwd = cwd;
          // AUR-200: was this Codex session spawned by a `codex exec`
          // call from another agent? If so, the next event we emit
          // should carry the parent linkage.
          const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
          const parent = consumeSpawn(
            "codex",
            cwd,
            ts ? new Date(ts).getTime() : Date.now(),
          );
          if (parent) cursor.pendingParentSpawnId = parent.parentEventId;
        }
        const model = payload.model;
        if (typeof model === "string") cursor.model = model;
        continue;
      }
      if (obj.type === "turn_context") {
        const model = payload.model;
        if (typeof model === "string") cursor.model = model;
        continue;
      }
      // Pair event_msg/token_count with the previous response event.
      if (obj.type === "event_msg") {
        const usage = extractTokenUsage(obj);
        if (usage && cursor.lastResponseId) {
          const key = `${usage.input}|${usage.cacheRead}|${usage.output}`;
          if (cursor.lastUsageKey !== key) {
            cursor.lastUsageKey = key;
            const model = cursor.model ?? "gpt-5";
            const cost = costOf(model, usage);
            sink.enrich(cursor.lastResponseId, { usage, cost, model });
          }
        }
        // Codex signals compaction via task_started/turn_truncated —
        // the equivalent of Claude's isCompactSummary.
        if (isCompactionEvent(obj)) {
          sink.emit({
            id: nextId(),
            ts: clampTs(
              typeof obj.timestamp === "string"
                ? obj.timestamp
                : new Date().toISOString(),
            ),
            agent: "codex",
            type: "compaction",
            sessionId,
            riskScore: riskOf("compaction"),
            summary: `[${cursor.project}] ⋈ context compacted`,
          });
        }
        continue;
      }
      // Handle function_call_output — pair with a pending tool event.
      if (
        obj.type === "response_item" &&
        payload.type === "function_call_output"
      ) {
        const callId =
          typeof payload.call_id === "string" ? payload.call_id : "";
        const pend = callId ? cursor.pendingCalls.get(callId) : undefined;
        if (pend) {
          cursor.pendingCalls.delete(callId);
          const out = payload.output;
          const outText =
            typeof out === "string"
              ? out
              : out && typeof out === "object"
                ? String(
                    (out as Record<string, unknown>).content ??
                      JSON.stringify(out),
                  )
                : "";
          const isError =
            !!out &&
            typeof out === "object" &&
            (out as Record<string, unknown>).status === "error";
          const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
          const duration = ts
            ? Math.max(0, new Date(ts).getTime() - pend.startMs)
            : undefined;
          sink.enrich(pend.eventId, {
            toolResult: outText.slice(0, 50_000),
            toolError: isError,
            ...(duration != null ? { durationMs: duration } : {}),
          });
        }
        continue;
      }

      const event = translate(obj, sessionId, cursor.project);
      if (!event) continue;
      // AUR-200: stamp the first event of a spawned session with its
      // parent agent_call event id, then clear the pending pointer.
      if (cursor.pendingParentSpawnId) {
        event.details = {
          ...(event.details ?? {}),
          parentSpawnId: cursor.pendingParentSpawnId,
        };
        cursor.pendingParentSpawnId = undefined;
      }
      sink.emit(event);
      if (event.type === "response") cursor.lastResponseId = event.id;
      // Track function_call events by call_id for later pairing.
      const cid = event.details?.toolUseId;
      if (cid && event.type !== "response" && event.type !== "prompt") {
        cursor.pendingCalls.set(cid, {
          eventId: event.id,
          startMs: new Date(event.ts).getTime(),
        });
        if (cursor.pendingCalls.size > MAX_PENDING) {
          const firstKey = cursor.pendingCalls.keys().next().value;
          if (firstKey !== undefined) cursor.pendingCalls.delete(firstKey);
        }
      }
    }
  };

  watcher.on("add", (f) => handle(f, true));
  watcher.on("change", (f) => handle(f, false));
  watcher.on("error", (err) => {
    if (typeof err === "object" && err !== null) {
      const code = (err as { code?: string }).code;
      if (code === "EMFILE" || code === "ENOSPC" || code === "EACCES") return;
    }
    // eslint-disable-next-line no-console
    console.error("[agentwatch/codex]", String(err));
  });

  return () => {
    void watcher.close();
  };
}

/** @internal exported for tests. */
export function translateCodexLine(
  obj: Record<string, unknown>,
  sessionId: string,
  project: string,
): AgentEvent | null {
  return translate(obj, sessionId, project);
}

function translate(
  obj: Record<string, unknown>,
  sessionId: string,
  project: string,
): AgentEvent | null {
  const ts = clampTs(typeof obj.ts === "string" ? obj.ts : String(obj.timestamp ?? ""));
  if (!ts) return null;
  const payload = (obj.payload ?? {}) as Record<string, unknown>;
  if (obj.type === "response_item") {
    const pType = payload.type;
    if (pType === "message") {
      const role = payload.role as string | undefined;
      if (role !== "user" && role !== "assistant") return null;
      const text = extractMessageText(payload);
      if (!text) return null;
      const type: EventType = role === "user" ? "prompt" : "response";
      return {
        id: nextId(),
        ts,
        agent: "codex",
        type,
        sessionId,
        riskScore: 0,
        summary: `[${project}] ${type}: ${truncate(text, 80)}`,
        details: { fullText: text },
      };
    }
    if (pType === "function_call") {
      const name = (payload.name as string | undefined) ?? "";
      const callId =
        typeof payload.call_id === "string" ? payload.call_id : "";
      const argsRaw = payload.arguments;
      const args = safeJson(typeof argsRaw === "string" ? argsRaw : "");
      if (name === "exec_command" || name === "shell" || name === "write_stdin") {
        const cmd =
          typeof args?.cmd === "string"
            ? args.cmd
            : typeof args?.input === "string"
              ? (args.input as string).slice(0, 200)
              : "";
        return {
          id: nextId(),
          ts,
          agent: "codex",
          type: "shell_exec",
          sessionId,
          cmd,
          tool: name,
          riskScore: riskOf("shell_exec", undefined, cmd),
          summary: `[${project}] shell: ${truncate(cmd, 80)}`,
          details: {
            toolInput: (args as Record<string, unknown> | null) ?? undefined,
            toolUseId: callId || undefined,
          },
        };
      }
      return {
        id: nextId(),
        ts,
        agent: "codex",
        type: "tool_call",
        sessionId,
        tool: name,
        riskScore: riskOf("tool_call", undefined, ""),
        summary: `[${project}] tool: ${name}`,
        details: {
          toolInput: (args as Record<string, unknown> | null) ?? undefined,
          toolUseId: callId || undefined,
        },
      };
    }
  }
  return null;
}

function extractMessageText(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (c && typeof c === "object") {
      const obj = c as Record<string, unknown>;
      const t = obj.text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.join("\n").trim();
}

/** Codex emits a few compaction-adjacent markers. We treat any of these
 *  as compaction for timeline purposes: truncation_policy triggered,
 *  explicit `turn_truncated` event, or a task_started whose truncation
 *  delta is non-zero (not always present). */
export function isCompactionEvent(obj: Record<string, unknown>): boolean {
  const payload = (obj.payload ?? {}) as Record<string, unknown>;
  const t = payload.type;
  if (t === "turn_truncated") return true;
  if (t === "compaction") return true; // future-proof for renamed event
  return false;
}

/** Pull the last-turn usage counts out of a Codex event_msg/token_count
 *  event. Codex schema (2026-04-15): payload.info.last_token_usage has
 *  input_tokens / cached_input_tokens / output_tokens / reasoning_output_tokens.
 *  Returns null for the periodic rate-limit-only events where info is null. */
export function extractTokenUsage(obj: Record<string, unknown>): {
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
} | null {
  const payload = (obj.payload ?? {}) as Record<string, unknown>;
  if (payload.type !== "token_count") return null;
  const info = payload.info;
  if (!info || typeof info !== "object") return null;
  const last = (info as Record<string, unknown>).last_token_usage as
    | Record<string, unknown>
    | undefined;
  if (!last) return null;
  const n = (v: unknown): number => (typeof v === "number" ? v : 0);
  return {
    input: n(last.input_tokens),
    cacheRead: n(last.cached_input_tokens),
    cacheCreate: 0,
    output: n(last.output_tokens) + n(last.reasoning_output_tokens),
  };
}

function safeJson(s: string): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function projectOf(cwd: string): string {
  const parts = cwd.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function extractSessionId(file: string): string {
  const base = basename(file, ".jsonl");
  const m = base.match(/rollout-[0-9T:\-.]+-(.+)$/);
  return m?.[1] ?? base;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function safeSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
