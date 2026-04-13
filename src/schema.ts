export type AgentName =
  | "claude-code"
  | "codex"
  | "cursor"
  | "gemini"
  | "openclaw"
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
