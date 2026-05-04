import chokidar from "chokidar";
import { existsSync, statSync } from "node:fs";
import { basename, sep } from "node:path";
import type { AgentEvent, EventType, EventSink } from "../schema.js";
import { clampTs, riskOf } from "../schema.js";
import { claudeProjectsDir } from "../util/workspace.js";
import { nextId } from "../util/ids.js";
import { detectAgentCall } from "../util/agent-call.js";
import { registerSpawn } from "../util/spawn-tracker.js";
import { costOf, parseUsage } from "../util/cost.js";
import { markAgentWrite } from "../util/recent-writes.js";
import { readNewlineTerminatedLines } from "../util/jsonl-stream.js";
import { createParseErrorTracker } from "../util/parse-errors.js";

type Emit = EventSink | ((e: AgentEvent) => void);

// Shared across the adapter's lifetime so pairing survives backfill
// arriving out of order (multiple sessions emit into the same maps).
// Bounded to prevent unbounded growth when tool_result never arrives
// (agent crashed mid-turn, corrupted session file, etc).
const MAX_PENDING_TOOL_USES = 5000;
const pendingToolUses = new Map<string, { eventId: string; ts: string }>();
const orphanResults = new Map<
  string,
  { ts: string; content: string; isError: boolean }
>();

function capMap<K, V>(m: Map<K, V>, max: number): void {
  while (m.size > max) {
    const first = m.keys().next().value;
    if (first === undefined) break;
    m.delete(first);
  }
}

interface FileCursor {
  offset: number;
}

/** When agentwatch restarts, each active session is backfilled from this
 *  many bytes behind EOF. 64 KB is ~20-50 turns — too small for heavy
 *  users who closed the TUI for a few hours. 4 MB covers ~days of a
 *  typical Claude session without blowing up memory (still bounded by
 *  MAX_EVENTS = 500 in the buffer). */
const BACKFILL_BYTES = 4 * 1024 * 1024;

export function startClaudeAdapter(sink: Emit): () => void {
  const normalized = normalizeSink(sink);
  const { emit, enrich } = normalized;
  const dir = claudeProjectsDir();
  if (!existsSync(dir)) {
    return () => {};
  }
  const parseErrors = createParseErrorTracker("claude-code", normalized);

  const cursors = new Map<string, FileCursor>();
  // chokidar v4 dropped glob support; watch the projects dir recursively
  // and filter by path regex. Two shapes matter:
  //   …/projects/<proj>/<session>.jsonl                  — main session
  //   …/projects/<proj>/<session>/subagents/<agent>.jsonl — subagent run
  const mainRe = /[\\/]projects[\\/][^\\/]+[\\/][^\\/]+\.jsonl$/;
  const subRe = /[\\/]projects[\\/][^\\/]+[\\/][^\\/]+[\\/]subagents[\\/][^\\/]+\.jsonl$/;
  const watcher = chokidar.watch(dir, {
    persistent: true,
    ignoreInitial: false,
    depth: 5,
  });

  const process = (file: string, isInitialAdd: boolean) => {
    const isSub = subRe.test(file);
    if (!isSub && !mainRe.test(file)) return;
    const size = safeSize(file);
    let cursor = cursors.get(file);
    if (!cursor) {
      const start = isInitialAdd ? Math.max(0, size - BACKFILL_BYTES) : size;
      cursor = { offset: start };
      cursors.set(file, cursor);
    }
    if (size <= cursor.offset) return;

    const start = cursor.offset;
    const sessionId = basename(file, ".jsonl");
    const project = extractProject(file);
    const subAgentId = isSub ? extractSubAgentId(file) : undefined;

    const { lines, consumed } = readNewlineTerminatedLines(
      file,
      start,
      size - 1,
    );
    cursor.offset = start + consumed;

    for (let i = 0; i < lines.length; i++) {
      // First line after a mid-file seek is a partial line; skip once.
      if (i === 0 && isInitialAdd && start > 0) continue;
      const line = lines[i]!;
      if (!line.trim()) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        parseErrors.recordFailure(sessionId, line);
        continue;
      }
      // First, harvest any tool_result blocks from user turns — they
      // correlate back to earlier tool_use events by tool_use_id.
      handleToolResults(obj, enrich);

      const event = translateClaudeLine(obj, sessionId, project, subAgentId);
      if (!event) continue;
      emit(event);
      // AUR-200: when this event invokes a child agent (codex/gemini/…),
      // register the spawn so we can chain-link the child session.
      if (event.details?.agentCall) {
        const cwd =
          typeof (obj as Record<string, unknown>).cwd === "string"
            ? ((obj as Record<string, unknown>).cwd as string)
            : "";
        registerSpawn({
          parentEventId: event.id,
          callee: event.details.agentCall.callee,
          cwd,
          registeredMs: new Date(event.ts).getTime(),
        });
      }
      // Mark attributed writes so the fs-watcher can dedupe.
      if (
        event.path &&
        (event.type === "file_write" || event.type === "file_read")
      ) {
        markAgentWrite(event.path, event.ts);
      }
      // If this event is a tool_use whose result already arrived
      // (backfill ordering quirk), attach it immediately.
      const toolUseId = event.details?.toolUseId;
      if (toolUseId && orphanResults.has(toolUseId)) {
        const orphan = orphanResults.get(toolUseId)!;
        orphanResults.delete(toolUseId);
        enrich(event.id, {
          toolResult: orphan.content,
          toolError: orphan.isError,
          durationMs: Math.max(
            0,
            new Date(orphan.ts).getTime() - new Date(event.ts).getTime(),
          ),
        });
      } else if (toolUseId) {
        pendingToolUses.set(toolUseId, {
          eventId: event.id,
          ts: event.ts,
        });
        capMap(pendingToolUses, MAX_PENDING_TOOL_USES);
      }
    }
  };

  watcher.on("add", (f) => process(f, true));
  watcher.on("change", (f) => process(f, false));
  watcher.on("error", (err) => {
    if (typeof err === "object" && err !== null) {
      const code = (err as { code?: string }).code;
      if (code === "EMFILE" || code === "ENOSPC" || code === "EACCES") return;
    }
    // eslint-disable-next-line no-console
    console.error("[agentwatch/claude]", String(err));
  });

  return () => {
    void watcher.close();
  };
}

/** Claude stores session files under ~/.claude/projects/<escaped-path>/<id>.jsonl
 *  where the escaped path replaces `/` with `-`. We return the last segment
 *  (e.g. `-Users-foo-IdeaProjects-auraqu` → `auraqu`). */
function extractProject(file: string): string {
  const parts = file.split(sep);
  const projIdx = parts.lastIndexOf("projects");
  if (projIdx >= 0 && parts[projIdx + 1]) {
    const dir = parts[projIdx + 1]!;
    const segs = dir.split("-").filter(Boolean);
    return segs[segs.length - 1] ?? dir;
  }
  return "";
}

function extractSubAgentId(file: string): string {
  // …/subagents/agent-<id>.jsonl → <id>
  const base = basename(file, ".jsonl");
  return base.replace(/^agent-/, "");
}

function normalizeSink(sink: Emit): EventSink {
  if (typeof sink === "function") {
    return { emit: sink, enrich: () => {} };
  }
  return sink;
}

/** Claude tool results live inside user turns: message.content[] with
 *  type:"tool_result", tool_use_id:"...". Walk them and enrich the
 *  matching tool_use event. */
function handleToolResults(
  obj: unknown,
  enrich: EventSink["enrich"],
): void {
  if (!obj || typeof obj !== "object") return;
  const o = obj as Record<string, unknown>;
  const role =
    o.role ?? (o.message as Record<string, unknown> | undefined)?.role;
  if (role !== "user") return;
  const content = (o.message as Record<string, unknown> | undefined)?.content;
  if (!Array.isArray(content)) return;
  const ts =
    (typeof o.timestamp === "string" && o.timestamp) ||
    new Date().toISOString();

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_result") continue;
    const id = typeof b.tool_use_id === "string" ? b.tool_use_id : undefined;
    if (!id) continue;
    const isError = b.is_error === true;
    const resultText = flattenResultContent(b.content);
    const subAgentId = extractSubAgentIdFromResult(resultText);
    const pending = pendingToolUses.get(id);
    if (pending) {
      pendingToolUses.delete(id);
      enrich(pending.eventId, {
        toolResult: resultText,
        toolError: isError,
        durationMs: Math.max(
          0,
          new Date(ts).getTime() - new Date(pending.ts).getTime(),
        ),
        ...(subAgentId ? { subAgentId } : {}),
      });
    } else {
      orphanResults.set(id, { ts, content: resultText, isError });
      if (orphanResults.size > 1000) {
        const first = orphanResults.keys().next().value;
        if (first) orphanResults.delete(first);
      }
    }
  }
}

/** When Claude's Agent tool returns, the result text includes a line like
 *  `agentId: ab3c99fca44a218cb` or an embedded JSON `"agentId":"..."`.
 *  Used to map a parent Agent tool_use event to its subagent session. */
function extractSubAgentIdFromResult(text: string): string | undefined {
  const m =
    text.match(/agentId[":\s]+([a-f0-9]{16,})/) ||
    text.match(/agent-([a-f0-9]{16,})/);
  return m?.[1];
}

const MAX_TOOL_RESULT_BYTES = 256 * 1024; // 256 KB hard cap; Bash stdout of a
// huge `find /` or `cat huge.log` otherwise blows up our memory.

function flattenResultContent(content: unknown): string {
  if (typeof content === "string") return capBytes(content);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (typeof c === "string") {
      parts.push(c);
    } else if (typeof c === "object" && c !== null) {
      const rec = c as Record<string, unknown>;
      if (typeof rec.text === "string") parts.push(rec.text);
    }
  }
  return capBytes(parts.join("\n"));
}

function capBytes(s: string, max = MAX_TOOL_RESULT_BYTES): string {
  if (s.length <= max) return s;
  const truncated = s.length - max;
  return (
    s.slice(0, max) +
    `\n\n… [${truncated.toLocaleString()} bytes truncated]`
  );
}

function safeSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

export function translateClaudeLine(
  obj: unknown,
  sessionId: string,
  project: string = "",
  subAgentId?: string,
): AgentEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const ts = clampTs(
    (typeof o.timestamp === "string" && o.timestamp) ||
      new Date().toISOString(),
  );
  const tagParts: string[] = [];
  if (project) tagParts.push(project);
  if (subAgentId) tagParts.push(`sub:${subAgentId.slice(0, 8)}`);
  const prefix = tagParts.length > 0 ? `[${tagParts.join(" / ")}] ` : "";

  const role = o.role ?? (o.message as Record<string, unknown> | undefined)?.role;
  const type = o.type;
  const content = (o.message as Record<string, unknown> | undefined)?.content;

  // Suppress obvious noise
  if (type === "tool_result" || type === "summary") return null;
  if (type === "worktree-state" || type === "compact") return null;

  // Assistant tool use — the real interesting signal. Walk content[] for
  // tool_use blocks and surface the tool name + command / path.
  if (type === "assistant" || role === "assistant") {
    const msg = o.message as Record<string, unknown> | undefined;
    const model = typeof msg?.model === "string" ? msg.model : "default";
    const usage = parseUsage(msg?.usage) ?? undefined;
    const cost = usage ? costOf(model, usage) : undefined;

    const toolUse = findToolUse(content);
    if (toolUse) {
      const evType = inferToolType(toolUse.name);
      const summary = buildToolSummary(toolUse);
      // AUR-199: detect when this Bash tool_use is invoking another
      // agent's CLI (codex exec, gemini -p, claude exec, ollama run …).
      // The richer agentCall metadata fuels the call-graph view (AUR-201)
      // and parent-span linkage in the OTel exporter (AUR-202).
      const agentCall =
        evType === "shell_exec" && toolUse.cmd
          ? detectAgentCall(toolUse.cmd)
          : null;
      // AUR-276: file_write events carry cwd so the session-correlation
      // linker can resolve the workspace root + branch without a
      // round-trip back to the adapter.
      const cwd = typeof o.cwd === "string" ? o.cwd : undefined;
      return {
        id: nextId(),
        ts,
        agent: "claude-code",
        type: evType,
        path: toolUse.path,
        cmd: toolUse.cmd,
        tool: toolUse.name,
        summary:
          prefix +
          (agentCall ? `→ ${agentCall.callee}: ${summary}` : summary),
        sessionId,
        riskScore: riskOf(evType, toolUse.path, toolUse.cmd),
        details: {
          toolInput: toolUse.input,
          toolUseId: toolUse.id,
          thinking: extractThinking(content),
          usage,
          cost,
          model,
          ...(agentCall ? { agentCall } : {}),
          ...(evType === "file_write" && cwd ? { cwd } : {}),
        },
      };
    }
    const text = extractText(content);
    const thinking = extractThinking(content);
    if (!text && !thinking) return null;
    return {
      id: nextId(),
      ts,
      agent: "claude-code",
      type: "response",
      summary: prefix + truncate(text || thinking || ""),
      sessionId,
      riskScore: riskOf("response"),
      details: {
        fullText: text || undefined,
        thinking: thinking || undefined,
        usage,
        cost,
        model,
      },
    };
  }

  if (type === "user" || role === "user") {
    const text = extractUserText(content);
    if (!text) return null; // suppress tool_result-only user turns
    if (o.isCompactSummary === true) {
      return {
        id: nextId(),
        ts,
        agent: "claude-code",
        type: "compaction",
        summary: prefix + "⋈ context compacted — " + truncate(text, 60),
        sessionId,
        riskScore: riskOf("compaction"),
        details: { fullText: text },
      };
    }
    return {
      id: nextId(),
      ts,
      agent: "claude-code",
      type: "prompt",
      summary: prefix + truncate(text),
      sessionId,
      riskScore: riskOf("prompt"),
      details: { fullText: text },
    };
  }

  return null;
}

interface ToolUse {
  name: string;
  path?: string;
  cmd?: string;
  input: Record<string, unknown>;
  id?: string;
}

function findToolUse(content: unknown): ToolUse | null {
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (rec.type !== "tool_use") continue;
    const name = typeof rec.name === "string" ? rec.name : "unknown";
    const id = typeof rec.id === "string" ? rec.id : undefined;
    const input = (rec.input ?? {}) as Record<string, unknown>;
    const path =
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string"
          ? input.path
          : undefined;
    const cmd = typeof input.command === "string" ? input.command : undefined;
    return { name, path, cmd, input, id };
  }
  return null;
}

function extractThinking(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (rec.type === "thinking" && typeof rec.thinking === "string") {
      parts.push(rec.thinking);
    }
  }
  return parts.join("\n").trim();
}

function buildToolSummary(t: ToolUse): string {
  // Prefer cmd for shell, path for file ops, a one-line arg summary otherwise.
  if (/^Bash/i.test(t.name) && t.cmd) return `Bash: ${truncate(t.cmd, 100)}`;
  if (/^(Write|Edit|MultiEdit|Read)/i.test(t.name) && t.path) {
    return `${t.name}: ${t.path}`;
  }
  if (/^(Grep|Glob)/i.test(t.name)) {
    const pat =
      typeof t.input.pattern === "string"
        ? t.input.pattern
        : typeof t.input.glob === "string"
          ? t.input.glob
          : "";
    return `${t.name}: ${truncate(pat, 100)}`;
  }
  if (/^Task/i.test(t.name)) {
    const desc =
      typeof t.input.description === "string" ? t.input.description : "";
    return `Task: ${truncate(desc, 100)}`;
  }
  if (/^WebFetch/i.test(t.name)) {
    const url = typeof t.input.url === "string" ? t.input.url : "";
    return `WebFetch: ${url}`;
  }
  // Fallback: tool name + first scalar input value
  const firstVal = Object.values(t.input).find(
    (v): v is string => typeof v === "string",
  );
  return firstVal ? `${t.name}: ${truncate(firstVal, 100)}` : t.name;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (rec.type === "thinking" && typeof rec.thinking === "string") {
      parts.push(rec.thinking);
    }
  }
  return parts.join(" ").trim();
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    }
    // tool_result blocks: skip — these are noise from the user's POV
  }
  return parts.join(" ").trim();
}

function inferToolType(name: string): EventType {
  if (/^Bash/i.test(name)) return "shell_exec";
  if (/^(Read|Grep|Glob)/i.test(name)) return "file_read";
  if (/^(Write|Edit|MultiEdit)/i.test(name)) return "file_write";
  return "tool_call";
}

function truncate(s: string, max = 140): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

