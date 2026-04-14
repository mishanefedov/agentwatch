import chokidar from "chokidar";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import type { AgentEvent, EventSink, EventType } from "../schema.js";
import { riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";

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
    }

    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const msg = m as Record<string, unknown>;
      const id = typeof msg.id === "string" ? msg.id : undefined;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const ev = translate(msg, sessionId, kind, project);
      if (ev) emit(ev);
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
  const ts =
    (typeof msg.timestamp === "string" && msg.timestamp) ||
    new Date().toISOString();
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

  return {
    id: nextId(),
    ts,
    agent: "gemini",
    type: eventType,
    sessionId,
    summary: prefix + truncate(text),
    riskScore: type === "error" ? 6 : riskOf(eventType),
    tool: kind === "subagent" ? "gemini:subagent" : "gemini",
    details: { fullText: text },
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
