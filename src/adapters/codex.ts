import chokidar from "chokidar";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, join, sep } from "node:path";
import os from "node:os";
import type { AgentEvent, EventSink, EventType } from "../schema.js";
import { clampTs, riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";

const BACKFILL_BYTES = 4 * 1024 * 1024;

export function codexSessionsDir(home: string = os.homedir()): string {
  return join(home, ".codex", "sessions");
}

interface Cursor {
  offset: number;
  project: string;
  /** Event id of the most recently emitted assistant response, so we
   *  can attach a later token_count event's usage data to it. */
  lastResponseId?: string;
  /** Usage last attributed to this cursor — used to de-dupe repeated
   *  token_count events that carry the same last_token_usage. */
  lastUsageKey?: string;
}

export function startCodexAdapter(sink: EventSink): () => void {
  const dir = codexSessionsDir();
  if (!existsSync(dir)) return () => {};

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
      cursor = { offset: start, project: "" };
      cursors.set(file, cursor);
    }
    if (size <= cursor.offset) return;

    const start = cursor.offset;
    const sessionId = extractSessionId(file);
    const stream = createReadStream(file, {
      start,
      end: size - 1,
      encoding: "utf8",
    });
    let consumed = 0;
    let skippedFirst = false;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      consumed += Buffer.byteLength(line, "utf8") + 1;
      if (isInitialAdd && start > 0 && !skippedFirst) {
        // First partial line after mid-file seek — skip.
        skippedFirst = true;
        return;
      }
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "session_meta") {
          const cwd = obj.payload?.cwd;
          if (typeof cwd === "string") cursor!.project = projectOf(cwd);
          return;
        }
        // Pair event_msg/token_count with the previous response event.
        if (obj.type === "event_msg") {
          const usage = extractTokenUsage(obj);
          if (usage && cursor!.lastResponseId) {
            const key = `${usage.input}|${usage.cacheRead}|${usage.output}`;
            if (cursor!.lastUsageKey !== key) {
              cursor!.lastUsageKey = key;
              sink.enrich(cursor!.lastResponseId, { usage });
            }
          }
          return;
        }
        const event = translate(obj, sessionId, cursor!.project);
        if (event) {
          sink.emit(event);
          if (event.type === "response") cursor!.lastResponseId = event.id;
        }
      } catch {
        /* malformed line */
      }
    });

    rl.on("close", () => {
      cursor!.offset = start + consumed;
    });
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
      const argsRaw = payload.arguments;
      const args = safeJson(typeof argsRaw === "string" ? argsRaw : "");
      if (name === "exec_command" || name === "shell") {
        const cmd = typeof args?.cmd === "string" ? args.cmd : "";
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
