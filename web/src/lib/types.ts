// Re-declared to avoid pulling node-flavoured src/schema.ts into the web
// bundle. Must stay in sync with src/schema.ts.

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

export interface AgentEvent {
  id: string;
  ts: string;
  agent: AgentName;
  type: EventType;
  path?: string;
  cmd?: string;
  tool?: string;
  summary?: string;
  sessionId?: string;
  riskScore: number;
  details?: {
    fullText?: string;
    thinking?: string;
    toolInput?: Record<string, unknown>;
    toolUseId?: string;
    source?: string;
    usage?: { input: number; cacheCreate: number; cacheRead: number; output: number };
    cost?: number;
    model?: string;
    toolResult?: string;
    durationMs?: number;
    toolError?: boolean;
    subAgentId?: string;
  };
}

export interface ProjectRow {
  name: string;
  eventCount: number;
  cost: number;
  lastTs?: string;
  sessionIds: string[];
}

export interface SessionRow {
  sessionId: string;
  agent: AgentName;
  firstTs?: string;
  lastTs?: string;
  eventCount: number;
  cost: number;
}

export interface DetectedAgent {
  name: AgentName;
  label: string;
  configPath?: string;
  present: boolean;
  instrumented?: boolean;
  eventCount: number;
  lastEventAt: string | null;
}
