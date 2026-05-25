/** Drains initial-scan backfill files one per macrotask so the event loop
 *  can service HTTP/SSE between files. Without this, a startup file-read
 *  storm (hundreds of session files) blocks the loop for seconds — freezing
 *  the TUI and the in-process web server. Live `change`/`add` events after
 *  the initial scan bypass the queue: they're one small read at a time. */
export function createBackfillQueue(
  processFile: (file: string) => void,
): { enqueue: (file: string) => void } {
  const queue: string[] = [];
  let draining = false;
  const drain = (): void => {
    const file = queue.shift();
    if (file === undefined) {
      draining = false;
      return;
    }
    try {
      processFile(file);
    } catch {
      // per-file isolation: one bad file never stalls the drain
    }
    setImmediate(drain);
  };
  return {
    enqueue(file: string): void {
      queue.push(file);
      if (!draining) {
        draining = true;
        setImmediate(drain);
      }
    },
  };
}
