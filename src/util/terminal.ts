/** Leaves the alternate screen buffer (if we entered it in index.tsx) and
 *  switches stdin back out of raw mode. Must run BEFORE any `process.exit`
 *  call, otherwise the shell inherits a raw-mode TTY and echo/cursor state
 *  stays broken until the user runs `stty sane`. */
export function restoreTerminal(): void {
  try {
    if (process.stdout.isTTY) process.stdout.write("\x1b[?1049l");
  } catch {
    /* ignore */
  }
  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
  } catch {
    /* ignore */
  }
  try {
    process.stdin.pause();
  } catch {
    /* ignore */
  }
}
