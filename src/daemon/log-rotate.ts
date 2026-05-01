import { closeSync, openSync, renameSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** Append-only log writer with a single rotation slot.
 *
 *  When the current log size exceeds `maxBytes`, the file is renamed to
 *  `<path>.1` (overwriting any previous one) and a fresh `<path>` is
 *  opened. The daemon never holds a long-running write stream — every
 *  `write` is `writeSync` so we don't have to drain on shutdown.
 *
 *  Single rotation slot is intentional: ten megabytes of history is the
 *  upper bound, plus a recent ten in `.1`. Anything older isn't worth
 *  the disk. Operators who want longer history pipe the log to a
 *  separate journal. */
export class RotatingLogStream {
  private fd: number;
  private bytes: number;
  private readonly path: string;
  private readonly maxBytes: number;

  constructor(opts: { path: string; maxBytes?: number }) {
    this.path = opts.path;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    mkdirSync(dirname(this.path), { recursive: true });
    this.fd = openSync(this.path, "a");
    try {
      this.bytes = statSync(this.path).size;
    } catch {
      this.bytes = 0;
    }
  }

  write(line: string): void {
    const buf = Buffer.from(line.endsWith("\n") ? line : `${line}\n`);
    if (this.bytes + buf.length > this.maxBytes) {
      this.rotate();
    }
    writeSync(this.fd, buf);
    this.bytes += buf.length;
  }

  /** Test seam — read current bytes-on-disk for assertions. */
  byteCount(): number {
    return this.bytes;
  }

  close(): void {
    try {
      closeSync(this.fd);
    } catch {
      // already closed
    }
  }

  private rotate(): void {
    try {
      closeSync(this.fd);
    } catch {
      // already closed
    }
    try {
      renameSync(this.path, `${this.path}.1`);
    } catch {
      // best effort — if rename fails (e.g. read-only fs) just keep
      // appending and let an operator handle it.
    }
    this.fd = openSync(this.path, "a");
    this.bytes = 0;
  }
}
