export type AgentName =
  | "claude-code"
  | "codex"
  | "cursor"
  | "gemini"
  | "openclaw"
  | "aider"
  | "cline"
  | "continue"
  | "windsurf"
  | "goose"
  | "unknown";

export type EventType =
  | "tool_call"
  | "file_read"
  | "file_write"
  | "file_change"
  | "shell_exec"
  | "prompt"
  | "response"
  | "session_start"
  | "session_end";

export interface EventDetails {
  /** Full prompt or response text, untruncated. */
  fullText?: string;
  /** Extended-thinking block content if present. */
  thinking?: string;
  /** Full tool_use input object for tool_call / shell_exec / file_* events. */
  toolInput?: Record<string, unknown>;
  /** Matches the tool_use_id in the jsonl so downstream correlators can
   *  pair this event with its tool_result. */
  toolUseId?: string;
  /** Full project/session path of the originating file. */
  source?: string;
  /** Token usage from an assistant turn (input / cache / output). */
  usage?: {
    input: number;
    cacheCreate: number;
    cacheRead: number;
    output: number;
  };
  /** Computed USD cost for this turn. */
  cost?: number;
  /** Model id that produced this event. */
  model?: string;
  /** Captured tool_result content (stdout / file body / search matches). */
  toolResult?: string;
  /** Milliseconds between tool_use emission and matched tool_result. */
  durationMs?: number;
  /** True if the matched tool_result had is_error set. */
  toolError?: boolean;
  /** Subagent id extracted from a Claude `Agent` tool_result.
   *  Events spawned by that run are stored in sessionId = `agent-<id>`. */
  subAgentId?: string;
}

/** Sink passed to adapters. Adapters emit new events and may later
 *  enrich an already-emitted event (e.g. attaching a tool_result to the
 *  original tool_use). */
export interface EventSink {
  emit: (event: AgentEvent) => void;
  enrich: (eventId: string, patch: Partial<EventDetails>) => void;
}

export interface AgentEvent {
  id: string;
  ts: string;
  agent: AgentName;
  type: EventType;
  path?: string;
  cmd?: string;
  tool?: string;
  summary?: string;
  promptId?: string;
  sessionId?: string;
  riskScore: number;
  details?: EventDetails;
}

export function riskOf(type: EventType, path?: string, cmd?: string): number {
  if (type === "shell_exec") {
    if (cmd && /\b(rm|sudo|curl|wget|chmod|chown)\b/.test(cmd)) return 9;
    return 6;
  }
  if (type === "file_write" || type === "file_change") {
    if (path && /\.(env|key|pem|credentials)/.test(path)) return 9;
    if (path && /(^|\/)(\.ssh|\.aws|\.gnupg)\//.test(path)) return 10;
    return 4;
  }
  if (type === "file_read") {
    if (path && /\.(env|key|pem|credentials)/.test(path)) return 7;
    return 2;
  }
  if (type === "tool_call") return 3;
  return 1;
}
