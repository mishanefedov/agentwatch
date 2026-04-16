import chokidar from "chokidar";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import type { AgentEvent, EventSink, EventType } from "../schema.js";
import { clampTs, riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";
import { costOf, type Usage } from "../util/cost.js";
import { consumeSpawn } from "../util/spawn-tracker.js";

type Emit = EventSink | ((e: AgentEvent) => void);

/**
 * Gemini CLI adapter.
 *
 * Storage layout (observed on dev machine):
 *   ~/.gemini/tmp/<projectDir>/chats/session-<ts>-<hash>.json
 *
 * Each file is a single JSON document (not JSONL) with the shape:
 *   { sessionId, projectHash, startTime, lastUpdated, kind, messages: [...] }
 *
 * Messages have { id, timestamp, type: "user" | "gemini" | "error" | "info",
 *                 content: [{ text }] }
 *
 * Sessions can be `kind: "main"` (top-level) or `kind: "subagent"` (spawned
 * via Gemini's delegation).
 *
 * Gemini's text doesn't contain structured tool_use blocks like Claude's.
 * The assistant describes tool intent in prose; we surface that as
 * `response` events. Heuristic detection of explicit run_shell_command or
 * write_file language would be brittle, so we don't try.
 */
export function startGeminiAdapter(sink: Emit): () => void {
  const { emit } = normalizeSink(sink);
  const root = join(homedir(), ".gemini", "tmp");
  if (!existsSync(root)) return () => {};

  // Track which message ids we've already emitted per session, keyed by
  // filename (sessions share ids across files in theory but filename is a
  // safer dedupe key).
  const emittedIds = new Map<string, Set<string>>();
  // AUR-200: per-file pending parent agent_call event id, set on the
  // first sighting of a Gemini session and consumed by the first event
  // we emit from that file.
  const pendingParentByFile = new Map<string, string>();

  const watcher = chokidar.watch(root, {
    persistent: true,
    ignoreInitial: false,
    depth: 4,
  });

  const sessionRe = /[\\/]chats[\\/]session-[^\\/]+\.json$/;

  const process = (file: string, _isInitial: boolean) => {
    if (!sessionRe.test(file)) return;
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return;
    }
    if (!doc || typeof doc !== "object") return;
    const d = doc as Record<string, unknown>;
    const sessionId =
      (typeof d.sessionId === "string" && d.sessionId) || basename(file, ".json");
    const kind = typeof d.kind === "string" ? d.kind : "main";
    const project = extractProject(file);
    const messages = Array.isArray(d.messages) ? d.messages : [];

    let seen = emittedIds.get(file);
    if (!seen) {
      seen = new Set();
      emittedIds.set(file, seen);
      // AUR-200: first time we see this Gemini session, check if it
      // was spawned by a `gemini -p ...` call from another agent.
      // We use empty cwd because Gemini's chat JSON doesn't carry it
      // (spawn-tracker treats empty as a wildcard, bounded by 60s TTL).
      const startTime =
        typeof d.startTime === "string" ? d.startTime : undefined;
      const spawnTs = startTime ? new Date(startTime).getTime() : Date.now();
      const parent = consumeSpawn("gemini", "", spawnTs);
      if (parent) pendingParentByFile.set(file, parent.parentEventId);
    }

    let firstEventEmitted = false;
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const msg = m as Record<string, unknown>;
      const id = typeof msg.id === "string" ? msg.id : undefined;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const ev = translate(msg, sessionId, kind, project);
      if (ev) {
        const parent = pendingParentByFile.get(file);
        if (parent && !firstEventEmitted) {
          ev.details = { ...(ev.details ?? {}), parentSpawnId: parent };
          pendingParentByFile.delete(file);
          firstEventEmitted = true;
        }
        emit(ev);
      }

      // Each Gemini assistant message can carry an array of toolCalls,
      // each already including the inline functionResponse. Emit one
      // event per tool with the result attached — no pairing needed.
      const toolCalls = msg.toolCalls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const te = translateToolCall(tc, msg, sessionId, kind, project);
          if (te) emit(te);
        }
      }
    }
  };

  watcher.on("add", (f) => process(f, true));
  watcher.on("change", (f) => process(f, false));
  watcher.on("error", swallow);

  return () => {
    void watcher.close();
  };
}

function translate(
  msg: Record<string, unknown>,
  sessionId: string,
  kind: string,
  project: string,
): AgentEvent | null {
  const ts = clampTs(
    (typeof msg.timestamp === "string" && msg.timestamp) ||
      new Date().toISOString(),
  );
  const type = typeof msg.type === "string" ? msg.type : "";
  const text = extractText(msg.content);

  const subAgentSuffix = kind === "subagent" ? " / sub:gemini" : "";
  const prefix = project ? `[${project}${subAgentSuffix}] ` : "";

  let eventType: EventType;
  if (type === "user") {
    if (!text) return null;
    eventType = "prompt";
  } else if (type === "gemini") {
    if (!text) return null;
    eventType = "response";
  } else if (type === "error") {
    if (!text) return null;
    eventType = "response";
  } else {
    return null; // skip info messages
  }

  const usage = extractGeminiUsage(msg);
  const model = pickModel(msg);
  const cost = usage ? costOf(model, usage) : undefined;

  return {
    id: nextId(),
    ts,
    agent: "gemini",
    type: eventType,
    sessionId,
    summary: prefix + truncate(text),
    riskScore: type === "error" ? 6 : riskOf(eventType),
    tool: kind === "subagent" ? "gemini:subagent" : "gemini",
    details: {
      fullText: text,
      ...(usage ? { usage, cost, model } : {}),
      ...(typeof (msg.thoughts as unknown) === "string" && msg.thoughts
        ? { thinking: msg.thoughts as string }
        : {}),
    },
  };
}

function pickModel(msg: Record<string, unknown>): string {
  if (typeof msg.model === "string") return msg.model;
  if (typeof msg.modelVersion === "string") return msg.modelVersion;
  return "gemini-2.5-pro";
}

/** Map a Gemini tool name to our event type + shape. */
function inferGeminiToolType(name: string): {
  type: EventType;
  path?: "file_path" | "path" | null;
} {
  const n = name.toLowerCase();
  if (n === "read_file" || n === "read_many_files") {
    return { type: "file_read", path: "file_path" };
  }
  if (
    n === "write_file" ||
    n === "replace" ||
    n === "edit" ||
    n === "create_file"
  ) {
    return { type: "file_write", path: "file_path" };
  }
  if (n === "run_shell_command" || n === "shell") {
    return { type: "shell_exec" };
  }
  return { type: "tool_call" };
}

/** Extract the result string out of Gemini's nested toolCall.result shape:
 *  [{ functionResponse: { response: { output: "..." } } }] */
function extractToolResult(raw: unknown): {
  text: string;
  isError: boolean;
} {
  if (!Array.isArray(raw)) return { text: "", isError: false };
  const parts: string[] = [];
  let isError = false;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const fr = (item as Record<string, unknown>).functionResponse;
    if (!fr || typeof fr !== "object") continue;
    const resp = (fr as Record<string, unknown>).response;
    if (!resp || typeof resp !== "object") continue;
    const r = resp as Record<string, unknown>;
    const out = r.output ?? r.error ?? r.content;
    if (typeof out === "string") parts.push(out);
    else if (out != null) parts.push(JSON.stringify(out));
    if (r.error) isError = true;
  }
  return { text: parts.join("\n\n").slice(0, 50_000), isError };
}

function translateToolCall(
  tc: unknown,
  parent: Record<string, unknown>,
  sessionId: string,
  kind: string,
  project: string,
): AgentEvent | null {
  if (!tc || typeof tc !== "object") return null;
  const c = tc as Record<string, unknown>;
  const name = typeof c.name === "string" ? c.name : "tool";
  const id = typeof c.id === "string" ? c.id : undefined;
  const args = (c.args ?? {}) as Record<string, unknown>;
  const { type, path: pathKey } = inferGeminiToolType(name);
  const path =
    pathKey && typeof args[pathKey] === "string"
      ? (args[pathKey] as string)
      : undefined;
  const cmd =
    type === "shell_exec" && typeof args.command === "string"
      ? (args.command as string)
      : undefined;
  const ts = clampTs(
    typeof parent.timestamp === "string"
      ? parent.timestamp
      : new Date().toISOString(),
  );
  const subAgentSuffix = kind === "subagent" ? " / sub:gemini" : "";
  const prefix = project ? `[${project}${subAgentSuffix}] ` : "";
  const { text: toolResult, isError } = extractToolResult(c.result);
  return {
    id: nextId(),
    ts,
    agent: "gemini",
    type,
    tool: `gemini:${name}`,
    sessionId,
    path,
    cmd,
    riskScore: riskOf(type, path, cmd),
    summary: prefix + (cmd ?? path ?? name),
    details: {
      toolInput: args,
      toolUseId: id,
      ...(toolResult ? { toolResult } : {}),
      ...(isError ? { toolError: true } : {}),
    },
  };
}

/** Gemini CLI emits tokens as:
 *   { input, output, cached, thoughts, tool, total }
 *
 * - `input` is the *total* input (including cached prefix)
 * - `cached` is the portion served from cache
 * - `output` is the visible response tokens
 * - `thoughts` is private chain-of-thought tokens, billed separately
 *
 * Our schema wants `input` = fresh uncached input, so we subtract.
 * We fold `thoughts` into `output` because both are billed at output
 * rates on current Gemini pricing tiers. */
export function extractGeminiUsage(
  msg: Record<string, unknown>,
): Usage | null {
  const t = msg.tokens;
  if (!t || typeof t !== "object") return null;
  const n = (v: unknown): number => (typeof v === "number" ? v : 0);
  const o = t as Record<string, unknown>;
  const input = n(o.input);
  const cached = n(o.cached);
  const output = n(o.output) + n(o.thoughts) + n(o.tool);
  const cacheRead = Math.max(0, cached);
  const fresh = Math.max(0, input - cached);
  if (fresh + cacheRead + output === 0) return null;
  return {
    input: fresh,
    cacheCreate: 0,
    cacheRead,
    output,
  };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
    } else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      if (typeof rec.text === "string") parts.push(rec.text);
    }
  }
  return parts.join("\n").trim();
}

function extractProject(file: string): string {
  // Expected: ~/.gemini/tmp/<projectDir>/chats/<session>.json
  // Extract the segment immediately after /tmp/ that is NOT "chats"
  // (guards against sessions stored in unexpected depths).
  const parts = file.split(sep);
  const tmpIdx = parts.lastIndexOf("tmp");
  if (tmpIdx >= 0) {
    const candidate = parts[tmpIdx + 1];
    if (candidate && candidate !== "chats") return candidate;
  }
  // Fallback: parent of /chats/
  const chatsIdx = parts.lastIndexOf("chats");
  if (chatsIdx > 0) {
    const cand = parts[chatsIdx - 1];
    if (cand && cand !== "tmp") return cand;
  }
  return "";
}

function truncate(s: string, max = 140): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

function normalizeSink(sink: Emit): EventSink {
  if (typeof sink === "function") return { emit: sink, enrich: () => {} };
  return sink;
}

function swallow(err: unknown): void {
  if (typeof err !== "object" || err === null) return;
  const code = (err as { code?: string }).code;
  if (code === "EMFILE" || code === "ENOSPC" || code === "EACCES") return;
  // eslint-disable-next-line no-console
  console.error("[agentwatch/gemini]", String(err));
}
