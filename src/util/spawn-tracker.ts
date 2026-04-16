import type { AgentName } from "../schema.js";

/**
 * Tracks recent `Bash(<agent-cli>)` invocations so that when the
 * spawned child agent's session_meta lands a few seconds later, we can
 * link the child session back to the parent event id. The parent
 * explicitly named the child (we matched the binary in agent-call.ts),
 * so the false-positive rate is low — much narrower than the cancelled
 * AUR-183 cross-agent-correlation work that tried to correlate
 * arbitrary agent pairs by heuristics.
 *
 * In-process state only. Bounded ring buffer with a TTL — old entries
 * fall out so a stale parent can't sit around for hours waiting for an
 * unrelated session to start with the same cwd.
 */

export interface PendingSpawn {
  /** AgentEvent id of the parent Bash(<agent-cli>) event. */
  parentEventId: string;
  /** The child agent the parent invoked (codex / gemini / etc). */
  callee: AgentName;
  /** cwd captured from the parent's session_meta — used to disambiguate
   *  multiple in-flight calls to the same agent. */
  cwd: string;
  /** Wall-clock ms when the parent event was emitted. */
  registeredMs: number;
}

const TTL_MS = 60_000;
const MAX_SIZE = 200;

const pending: PendingSpawn[] = [];

export function registerSpawn(entry: PendingSpawn): void {
  pending.push(entry);
  prune(entry.registeredMs);
}

/** Find the most recent matching spawn for `(callee, cwd)`. Removes it
 *  from the queue so two consecutive sessions with the same cwd don't
 *  both link to the first parent. Returns null when no match within TTL. */
export function consumeSpawn(
  callee: AgentName,
  cwd: string,
  nowMs: number = Date.now(),
): PendingSpawn | null {
  prune(nowMs);
  // Walk newest-first so we link to the most recent parent — matches
  // human intuition when the same caller fired several times in a row.
  for (let i = pending.length - 1; i >= 0; i--) {
    const candidate = pending[i]!;
    if (candidate.callee !== callee) continue;
    if (!cwdMatches(candidate.cwd, cwd)) continue;
    pending.splice(i, 1);
    return candidate;
  }
  return null;
}

/** Drop everything older than TTL_MS or beyond the size cap. */
function prune(nowMs: number): void {
  while (pending.length > 0 && nowMs - pending[0]!.registeredMs > TTL_MS) {
    pending.shift();
  }
  while (pending.length > MAX_SIZE) {
    pending.shift();
  }
}

/** Two cwds match if they're equal, one is a prefix path of the other
 *  (handles symlinks / `~/` expansion / monorepo subdirs), OR either
 *  side is empty. The empty-side case is a deliberate wildcard for
 *  child agents whose session files don't carry cwd (Gemini chat
 *  JSON). The 60s TTL bounds the false-positive blast radius — two
 *  concurrent council invocations across separate workspaces is the
 *  pathological case we accept. */
function cwdMatches(a: string, b: string): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  const aTrim = a.replace(/\/+$/, "");
  const bTrim = b.replace(/\/+$/, "");
  return aTrim === bTrim || aTrim.startsWith(bTrim + "/") || bTrim.startsWith(aTrim + "/");
}

/** Test helper — wipes the queue between tests. */
export function _resetSpawnTracker(): void {
  pending.length = 0;
}

/** Test / debug helper — read-only view of the queue. */
export function _pendingSpawns(): readonly PendingSpawn[] {
  return pending;
}
