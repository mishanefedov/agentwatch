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

/** Byte offset to start reading a file from. Live appends and stale files
 *  start at EOF (`size`); recently-modified files on the initial scan are
 *  backfilled `backfillBytes` behind EOF to catch turns written while
 *  agentwatch was off. */
export function backfillStartOffset(
  file: string,
  size: number,
  isInitialAdd: boolean,
  backfillBytes: number,
): number {
  if (!isInitialAdd) return size;
  if (mtimeMs(file) < Date.now() - BACKFILL_MAX_AGE_MS) return size;
  return Math.max(0, size - backfillBytes);
}
