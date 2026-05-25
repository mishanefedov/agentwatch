import { statSync } from "node:fs";

/** On the initial scan, only re-read files modified within this window.
 *  Older sessions' events are already in the SQLite store (the TUI and
 *  `serve` seed their timeline from it), so re-reading hundreds of stale
 *  files at boot just blocks the event loop for seconds. Stale files tail
 *  from EOF instead — their history is already in the store. */
export const BACKFILL_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function mtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// Skipping stale files' backfill is only safe once the SQLite store holds
// prior history to seed the timeline from. On a fresh install, a deleted /
// pruned DB, or a store-open failure, skipping would drop those files'
// events entirely (they were never ingested). The startup path enables this
// only after confirming the store is non-empty; default off = always backfill.
let staleSkipEnabled = false;

/** Set once at startup, before adapters start. Pass `true` only when the
 *  store already has history (so stale files are already ingested). */
export function setStaleSkipEnabled(enabled: boolean): void {
  staleSkipEnabled = enabled;
}

/** Byte offset to start reading a file from. Live appends start at EOF
 *  (`size`). On the initial scan, recently-modified files are backfilled
 *  `backfillBytes` behind EOF to catch turns written while agentwatch was
 *  off; stale files start at EOF only when stale-skip is enabled (the store
 *  already has their history). */
export function backfillStartOffset(
  file: string,
  size: number,
  isInitialAdd: boolean,
  backfillBytes: number,
): number {
  if (!isInitialAdd) return size;
  if (staleSkipEnabled && mtimeMs(file) < Date.now() - BACKFILL_MAX_AGE_MS) {
    return size;
  }
  return Math.max(0, size - backfillBytes);
}
