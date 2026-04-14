/**
 * Module-scoped cache of paths recently written by an attributed agent.
 * fs-watcher consults this before emitting a generic `file_change` event to
 * avoid double-counting Claude / OpenClaw / Cursor edits.
 */

const DEDUPE_WINDOW_MS = 5_000;
const EXPIRY_MS = 30_000;

const recent = new Map<string, number>();
let lastSweep = 0;

export function markAgentWrite(path: string, ts: string | number = Date.now()): void {
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts;
  if (!path || Number.isNaN(t)) return;
  recent.set(path, t);
  sweepIfDue();
}

export function wasRecentlyWrittenByAgent(path: string): boolean {
  const t = recent.get(path);
  if (t == null) return false;
  return Date.now() - t <= DEDUPE_WINDOW_MS;
}

function sweepIfDue(): void {
  const now = Date.now();
  if (now - lastSweep < EXPIRY_MS) return;
  lastSweep = now;
  for (const [p, t] of recent) {
    if (now - t > EXPIRY_MS) recent.delete(p);
  }
}
