import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { AgentEvent, EventDetails, EventSink, EventType } from "../schema.js";
import { clampTs, riskOf } from "../schema.js";
import { markHookSeen, toolSignature } from "./hooks-dedup.js";

const KNOWN_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "Notification",
] as const;

type HookEventName = (typeof KNOWN_HOOK_EVENTS)[number] | string;

interface HookPayload {
  hook_event_name?: HookEventName;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown> | string;
  tool_use_id?: string;
  prompt?: string;
  message?: string;
  source?: string;
  trigger?: string;
}

/** Register POST /api/hooks/:event on the Fastify app so Claude Code
 *  can shell-out a curl call from each hook stanza. The route is
 *  intentionally lenient — unknown events are still ingested as
 *  generic tool_call events so a future Claude release that adds new
 *  hook types doesn't silently drop data. */
export function registerClaudeHooksRoute(
  app: FastifyInstance,
  sink: EventSink,
): void {
  app.post<{ Params: { event: string }; Body: HookPayload }>(
    "/api/hooks/:event",
    async (req) => {
      const eventName = decodeURIComponent(req.params.event);
      const body = (req.body ?? {}) as HookPayload;
      const event = translateHook(eventName, body);
      if (!event) return { ok: false, reason: "unrecognized payload" };
      const sig = toolSignature(event.sessionId, body.tool_use_id);
      if (sig) markHookSeen(sig);
      sink.emit(event);
      return { ok: true, eventId: event.id };
    },
  );
}

export function translateHook(
  hookName: HookEventName,
  body: HookPayload,
): AgentEvent | null {
  const ts = clampTs(new Date().toISOString());
  const sessionId = body.session_id;
  const cwd = body.cwd;
  const id = `hooks:${randomUUID()}`;
  const details: EventDetails = {
    source: body.transcript_path ?? "hooks",
  };
  // Stamp the canonical "via hooks" marker so the dedup wrapper can
  // distinguish between a hook event (mark) and a JSONL event (check).
  (details as { source?: string }).source = "hooks";

  const projectPrefix = cwd ? `[${basenameOf(cwd)}] ` : "";

  switch (hookName) {
    case "SessionStart": {
      return {
        id,
        ts,
        agent: "claude-code",
        type: "session_start",
        riskScore: 1,
        ...(sessionId ? { sessionId } : {}),
        summary: `${projectPrefix}SessionStart${body.source ? ` (${body.source})` : ""}`,
        details,
      };
    }
    case "SessionEnd":
    case "Stop":
    case "SubagentStop": {
      return {
        id,
        ts,
        agent: "claude-code",
        type: "session_end",
        riskScore: 1,
        ...(sessionId ? { sessionId } : {}),
        summary: `${projectPrefix}${hookName}`,
        details,
      };
    }
    case "UserPromptSubmit": {
      const text = body.prompt ?? "";
      return {
        id,
        ts,
        agent: "claude-code",
        type: "prompt",
        riskScore: 1,
        ...(sessionId ? { sessionId } : {}),
        summary: `${projectPrefix}${truncate(text, 80)}`,
        details: { ...details, fullText: text },
      };
    }
    case "PreToolUse": {
      const tool = body.tool_name ?? "tool";
      const type = mapToolToType(tool, body.tool_input);
      const path = pathFromInput(body.tool_input);
      const cmd = cmdFromInput(body.tool_input);
      const summary = `${projectPrefix}${tool}: ${path ?? cmd ?? truncate(JSON.stringify(body.tool_input ?? {}), 60)}`;
      return {
        id,
        ts,
        agent: "claude-code",
        type,
        riskScore: riskOf(type, path, cmd),
        ...(sessionId ? { sessionId } : {}),
        tool,
        summary,
        ...(path ? { path } : {}),
        ...(cmd ? { cmd } : {}),
        details: {
          ...details,
          ...(body.tool_input ? { toolInput: body.tool_input } : {}),
          ...(body.tool_use_id ? { toolUseId: body.tool_use_id } : {}),
        },
      };
    }
    case "PostToolUse": {
      const tool = body.tool_name ?? "tool";
      const path = pathFromInput(body.tool_input);
      const cmd = cmdFromInput(body.tool_input);
      const result =
        typeof body.tool_response === "string"
          ? body.tool_response
          : body.tool_response
            ? JSON.stringify(body.tool_response)
            : "";
      const summary = `${projectPrefix}${tool} done: ${path ?? cmd ?? "result"}`;
      return {
        id,
        ts,
        agent: "claude-code",
        type: "tool_call",
        riskScore: 1,
        ...(sessionId ? { sessionId } : {}),
        tool,
        summary,
        ...(path ? { path } : {}),
        ...(cmd ? { cmd } : {}),
        details: {
          ...details,
          toolResult: result.slice(0, 8 * 1024),
          ...(body.tool_use_id ? { toolUseId: body.tool_use_id } : {}),
        },
      };
    }
    case "PreCompact":
    case "PostCompact": {
      return {
        id,
        ts,
        agent: "claude-code",
        type: "compaction",
        riskScore: 1,
        ...(sessionId ? { sessionId } : {}),
        summary: `${projectPrefix}${hookName}${body.trigger ? ` (${body.trigger})` : ""}`,
        details,
      };
    }
    case "Notification": {
      const text = body.message ?? "";
      return {
        id,
        ts,
        agent: "claude-code",
        type: "response",
        riskScore: 1,
        ...(sessionId ? { sessionId } : {}),
        summary: `${projectPrefix}Notification: ${truncate(text, 80)}`,
        details: { ...details, fullText: text },
      };
    }
    default: {
      // Unknown hook — surface as a generic tool_call so the user can
      // see it in the timeline, but with the original event name.
      return {
        id,
        ts,
        agent: "claude-code",
        type: "tool_call",
        riskScore: 1,
        ...(sessionId ? { sessionId } : {}),
        tool: hookName,
        summary: `${projectPrefix}hook:${hookName}`,
        details: { ...details, toolInput: body as unknown as Record<string, unknown> },
      };
    }
  }
}

function mapToolToType(tool: string, input?: Record<string, unknown>): EventType {
  const t = tool.toLowerCase();
  if (t === "bash") return "shell_exec";
  if (t === "read") return "file_read";
  if (t === "write" || t === "edit" || t === "multiedit") return "file_write";
  if (input && (input.command || input.cmd)) return "shell_exec";
  if (input && (input.file_path || input.path)) return "file_read";
  return "tool_call";
}

function pathFromInput(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const candidate = input.file_path ?? input.path ?? input.notebook_path;
  return typeof candidate === "string" ? candidate : undefined;
}

function cmdFromInput(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const candidate = input.command ?? input.cmd;
  return typeof candidate === "string" ? candidate : undefined;
}

function basenameOf(p: string): string {
  const idx = p.replace(/\/$/, "").lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
