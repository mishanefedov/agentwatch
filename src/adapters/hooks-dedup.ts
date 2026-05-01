import type { AgentEvent, EventSink } from "../schema.js";

/** When the same logical Claude Code event arrives via both the
 *  hooks adapter and the JSONL tail, hooks win — they're real-time and
 *  authoritative. The JSONL emit is suppressed on a 5-second
 *  correlation window keyed on `<session_id>:<tool_use_id>`.
 *
 *  Module-global because both adapters need to talk to the same
 *  registry. The 5-second window is purely time-based: stale entries
 *  are evicted lazily on access. */

const WINDOW_MS = 5000;

const seen = new Map<string, number>();

export function markHookSeen(signature: string): void {
  seen.set(signature, Date.now());
  // Keep the registry small — drop anything older than 60s on every
  // write. 60s is a generous upper bound (10x the dedup window).
  if (seen.size > 1000) evictOlderThan(60_000);
}

export function wasHookSeen(signature: string): boolean {
  const t = seen.get(signature);
  if (t == null) return false;
  if (Date.now() - t > WINDOW_MS) {
    seen.delete(signature);
    return false;
  }
  return true;
}

export function clearHookDedup(): void {
  seen.clear();
}

function evictOlderThan(ms: number): void {
  const cutoff = Date.now() - ms;
  for (const [sig, t] of seen) {
    if (t < cutoff) seen.delete(sig);
  }
}

/** Build the dedup signature for a tool-related Claude event. Returns
 *  null when there's nothing to dedup against (no session id or no
 *  tool_use_id). */
export function toolSignature(
  sessionId: string | undefined,
  toolUseId: string | undefined,
): string | null {
  if (!sessionId || !toolUseId) return null;
  return `${sessionId}:${toolUseId}`;
}

/** Wrap an EventSink so JSONL claude-code tool events are dropped
 *  when a hook adapter has already emitted the same logical event.
 *  The hooks adapter itself stamps `details.source = "hooks"`; we
 *  use that as the bypass signal so hook events never dedup against
 *  themselves. */
export function withClaudeHookDedup(inner: EventSink): EventSink {
  return {
    emit: (e: AgentEvent) => {
      if (e.agent === "claude-code" && e.details?.source !== "hooks") {
        const sig = toolSignature(e.sessionId, e.details?.toolUseId);
        if (sig && wasHookSeen(sig)) return; // suppressed
      }
      inner.emit(e);
    },
    enrich: inner.enrich,
  };
}
