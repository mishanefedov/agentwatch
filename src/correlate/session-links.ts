import type { AgentName } from "../schema.js";

/** AUR-276: per-path index of recent attributed writes within a sliding
 *  30-min window. Pure data structure — no I/O, no subprocess, no SQLite.
 *  Caller hands us each (path, agent, sessionId, ts, branch, root) and
 *  receives back any matching peer entries that satisfy:
 *
 *    - different agent
 *    - different session
 *    - same workspace_root (both non-null)
 *    - same git_branch    (both non-null)
 *    - within WINDOW_MS of `ts`
 *
 *  ASCII model:
 *
 *    RecentWritesIndex
 *    ┌────────────────────────────────────────────────────┐
 *    │  path ─────► [ {agent, sess, ts, branch, root} ]   │
 *    │              (append-order; sweep drops aged-out)  │
 *    │                                                    │
 *    │  recordAndQuery(path, agent, sess, ts, br, root)   │
 *    │    1. drop entries older than ts - WINDOW_MS       │
 *    │    2. matches = entries where                      │
 *    │         e.agent  != agent                          │
 *    │       AND e.sess != sess                           │
 *    │       AND e.branch === branch && branch != null    │
 *    │       AND e.root   === root   && root   != null    │
 *    │    3. push new entry                               │
 *    │    4. return matches                               │
 *    └────────────────────────────────────────────────────┘
 *
 *  Memory: capped at MAX_ENTRIES; oldest 10 % evicted on overflow.
 *  This is a backstop — under normal load the 30-min sweep keeps the
 *  index well under the cap.
 */

export const WINDOW_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 50_000;
const EVICT_FRACTION = 0.1;

export interface RecentWriteEntry {
  agent: AgentName;
  sessionId: string;
  ts: number; // ms since epoch
  branch: string | null;
  root: string | null;
}

export class RecentWritesIndex {
  private byPath = new Map<string, RecentWriteEntry[]>();
  private size = 0;

  /** Record a write and return any peer entries that should be linked
   *  per the gate above. Returned entries are *not* removed from the
   *  index — the same peer may legitimately link to multiple later
   *  writes in the window. */
  recordAndQuery(
    path: string,
    agent: AgentName,
    sessionId: string,
    tsMs: number,
    branch: string | null,
    root: string | null,
  ): RecentWriteEntry[] {
    const cutoff = tsMs - WINDOW_MS;
    const bucket = this.byPath.get(path);
    const matches: RecentWriteEntry[] = [];
    if (bucket) {
      // Drop aged-out entries up-front; cheap, keeps the bucket small.
      let kept = 0;
      for (const entry of bucket) {
        if (entry.ts < cutoff) {
          this.size -= 1;
          continue;
        }
        bucket[kept++] = entry;
        if (
          entry.agent !== agent &&
          entry.sessionId !== sessionId &&
          entry.branch != null &&
          branch != null &&
          entry.branch === branch &&
          entry.root != null &&
          root != null &&
          entry.root === root
        ) {
          matches.push(entry);
        }
      }
      bucket.length = kept;
      if (kept === 0) this.byPath.delete(path);
    }
    // Append the new entry.
    const newEntry: RecentWriteEntry = {
      agent,
      sessionId,
      ts: tsMs,
      branch,
      root,
    };
    const next = this.byPath.get(path);
    if (next) {
      next.push(newEntry);
    } else {
      this.byPath.set(path, [newEntry]);
    }
    this.size += 1;
    if (this.size > MAX_ENTRIES) this.evictOldest();
    return matches;
  }

  /** Test/diagnostic: total entries currently held. */
  entryCount(): number {
    return this.size;
  }

  /** Test-only: drop everything. */
  reset(): void {
    this.byPath.clear();
    this.size = 0;
  }

  /** Hard-cap eviction: collect every entry, sort by ts ascending,
   *  drop the oldest EVICT_FRACTION. Cheap relative to MAX_ENTRIES,
   *  rare in practice — sweep keeps us well under the cap normally. */
  private evictOldest(): void {
    const toDrop = Math.max(1, Math.floor(MAX_ENTRIES * EVICT_FRACTION));
    const allTs: number[] = [];
    for (const bucket of this.byPath.values()) {
      for (const e of bucket) allTs.push(e.ts);
    }
    if (allTs.length <= toDrop) {
      this.byPath.clear();
      this.size = 0;
      return;
    }
    allTs.sort((a, b) => a - b);
    const cutoff = allTs[toDrop - 1] ?? -Infinity;
    for (const [path, bucket] of this.byPath) {
      let kept = 0;
      for (const e of bucket) {
        if (e.ts <= cutoff) {
          this.size -= 1;
          continue;
        }
        bucket[kept++] = e;
      }
      bucket.length = kept;
      if (kept === 0) this.byPath.delete(path);
    }
  }
}
