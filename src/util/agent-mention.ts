/**
 * Cheap substring heuristic for "does this scheduled-job command look
 * agent-related" — used to badge launchd agents / crontab lines that
 * likely invoke an AI coding agent, so they stand out from ordinary
 * system cron/launchd noise on the scheduled-jobs surface.
 *
 * Deliberately a substring match, not the precise argv-rule matching in
 * `agent-call.ts` (which exists for a different job: turning a shell
 * command into structured agent-to-agent call metadata for the call
 * graph). Here we only need a yes/no badge.
 */

export const KNOWN_AGENT_KEYWORDS = [
  "claude",
  "codex",
  "gemini",
  "openclaw",
  "agentwatch",
] as const;

export function mentionsKnownAgent(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return KNOWN_AGENT_KEYWORDS.some((kw) => lower.includes(kw));
}
