import type { AgentName, EventType } from "./types";

export function formatTime(ts: string): string {
  return ts.slice(11, 19); // HH:MM:SS
}

export function formatDateTime(ts: string): string {
  return ts.slice(0, 19).replace("T", " ");
}

/** MM-DD HH:MM:SS — compact but unambiguous for a timeline row. */
export function formatShortDate(ts: string): string {
  return `${ts.slice(5, 10)} ${ts.slice(11, 19)}`;
}

export function formatUSD(n: number | undefined | null): string {
  if (n == null) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function formatTokens(n: number | undefined | null): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

const AGENT_COLORS: Record<string, string> = {
  "claude-code": "text-orange-400",
  codex: "text-emerald-400",
  cursor: "text-fuchsia-400",
  gemini: "text-blue-400",
  openclaw: "text-cyan-400",
  hermes: "text-yellow-400",
  aider: "text-pink-400",
  cline: "text-lime-400",
  windsurf: "text-teal-400",
  goose: "text-amber-400",
  continue: "text-purple-400",
  unknown: "text-gray-400",
};

export function agentColor(a: AgentName): string {
  return AGENT_COLORS[a] ?? "text-gray-400";
}

const TYPE_ICON: Record<string, string> = {
  prompt: "→",
  response: "←",
  tool_call: "▸",
  shell_exec: "$",
  file_write: "✎",
  file_read: "👁",
  file_change: "~",
  compaction: "⟳",
  session_start: "●",
  session_end: "○",
};

export function typeIcon(t: EventType): string {
  return TYPE_ICON[t] ?? "•";
}

const RISK_CLASS: Record<number, string> = {};
for (let i = 0; i <= 10; i++) {
  if (i >= 8) RISK_CLASS[i] = "bg-danger/20 text-danger";
  else if (i >= 5) RISK_CLASS[i] = "bg-warn/20 text-warn";
  else if (i >= 2) RISK_CLASS[i] = "bg-accent/10 text-accent";
  else RISK_CLASS[i] = "bg-fg/5 text-fg-dim";
}
export function riskClass(score: number): string {
  return RISK_CLASS[Math.max(0, Math.min(10, score))] ?? "";
}
