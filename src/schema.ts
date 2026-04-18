export type AgentName =
  | "claude-code"
  | "codex"
  | "cursor"
  | "gemini"
  | "openclaw"
  | "hermes"
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
  | "compaction"
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
  /** Set when this event represents one agent invoking another via the
   *  child agent's CLI (e.g. `codex exec`, `gemini -p`). The parent
   *  event is the outer Bash / shell_exec; the spawned child agent's
   *  session events get linked back via `parentSpawnId` (AUR-200). */
  agentCall?: {
    callee: AgentName;
    /** Extracted prompt argument when we can parse it (`-p ...`,
     *  `exec ...`, etc.). Undefined when the invocation was free-form. */
    prompt?: string;
    /** Sub-shape of the call: `exec` is "give a prompt and exit",
     *  `chat` is interactive REPL, `unknown` is a generic invocation
     *  whose semantics we couldn't classify. */
    kind: "exec" | "chat" | "unknown";
    /** Optional model the child was invoked with (e.g. `ollama run llama3`). */
    model?: string;
  };
  /** Linked back to the parent agent_call event id when this event
   *  belongs to a session that was spawned by a Bash(<agent-cli>) call.
   *  Set on the *first* event of the spawned session — descendants
   *  inherit by sessionId. */
  parentSpawnId?: string;
  /** Marks an event as belonging to a scheduled task — either an
   *  OpenClaw cron job or a periodic heartbeat run. AUR-204+. */
  scheduled?: {
    kind: "cron" | "heartbeat";
    /** Cron job id from `~/.openclaw/cron/jobs.json` (cron only). */
    jobId?: string;
    /** Agent id the job/heartbeat is tied to (`main`, `content`, …). */
    agentId?: string;
    /** Human label — job name for cron, task name for heartbeat. */
    label?: string;
    /** Freeform schedule string: `every 5m`, a 5-field cron expression,
     *  or `at <iso>`. Source-of-truth is the openclaw jobs.json. */
    schedule?: string;
    /** ms-since-epoch this scheduled instance was supposed to fire. */
    scheduledAtMs?: number;
    /** Per-run identifier when the runtime emits one
     *  (e.g. `cron:<jobId>:run:<runId>`). */
    runId?: string;
  };
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

/** Clamp an ISO timestamp so future-dated events don't break sort order.
 *  System clock skew between agent machines + our TUI can produce `ts`
 *  values ahead of `Date.now()`; we cap at now + 60s to accommodate
 *  minor drift without letting a broken clock poison the timeline. */
export function clampTs(ts: string): string {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return new Date().toISOString();
  const now = Date.now();
  if (t > now + 60_000) return new Date(now).toISOString();
  return ts;
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
