import { closeSync, openSync, readSync } from "node:fs";

export interface LineBatch {
  /** Newline-terminated lines from the slice (newline stripped). The
   *  trailing partial line, if any, is dropped — caller will re-read it
   *  on the next iteration once more bytes arrive. */
  lines: string[];
  /** Bytes consumed from `start`. Always points at a newline boundary or
   *  zero. The caller advances their cursor by exactly this amount; any
   *  unterminated tail stays unread until the next call. */
  consumed: number;
}

/** Read [start, end] from `file` synchronously and return only the
 *  newline-terminated lines plus the byte count of those terminated
 *  lines. Used by JSONL adapters whose source files can be flushed
 *  mid-line by their producing process — under the previous readline
 *  implementation we'd parse the partial line, fail JSON.parse, advance
 *  past it, and permanently lose the event when the rest of the line was
 *  later appended. AUR-227. */
export function readNewlineTerminatedLines(
  file: string,
  start: number,
  end: number,
): LineBatch {
  if (end < start) return { lines: [], consumed: 0 };
  const size = end - start + 1;
  const buf = Buffer.alloc(size);
  let read = 0;
  const fd = openSync(file, "r");
  try {
    while (read < size) {
      const n = readSync(fd, buf, read, size - read, start + read);
      if (n <= 0) break;
      read += n;
    }
  } finally {
    closeSync(fd);
  }
  const slice = read < size ? buf.subarray(0, read) : buf;
  const lastNl = slice.lastIndexOf(0x0a);
  if (lastNl < 0) return { lines: [], consumed: 0 };
  const terminated = slice.subarray(0, lastNl).toString("utf8");
  const lines = terminated === "" ? [] : terminated.split("\n");
  return { lines, consumed: lastNl + 1 };
}
