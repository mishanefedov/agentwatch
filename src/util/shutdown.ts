/**
 * Process-wide shutdown registry.
 *
 * Adapters and the web server register synchronous cleanup functions
 * here. When a signal arrives (SIGINT / SIGTERM / SIGHUP) or the TUI
 * exits, `runShutdownHooks` drains the registry in LIFO order so
 * chokidar watchers close, better-sqlite3 handles flush, and SSE
 * sockets get a clean `end()` before the process dies.
 *
 * Previously: adapters were started inside React useEffect and only
 * torn down by the unmount path. A SIGINT-driven `process.exit(0)`
 * skipped React entirely, orphaning fs watchers and SQLite readers
 * (and, on some systems, leaving the terminal in alt-screen mode).
 */

type Hook = () => void | Promise<void>;

const hooks: Hook[] = [];
let draining = false;

export function onShutdown(fn: Hook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.lastIndexOf(fn);
    if (i !== -1) hooks.splice(i, 1);
  };
}

/** Run every registered hook, newest first, swallowing per-hook errors
 *  so one failing adapter doesn't strand the others. Idempotent — a
 *  second call is a no-op (a signal can arrive during cleanup). */
export async function runShutdownHooks(): Promise<void> {
  if (draining) return;
  draining = true;
  while (hooks.length > 0) {
    const fn = hooks.pop()!;
    try {
      await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[agentwatch] shutdown hook failed:", err);
    }
  }
}

/** Test helper — reset state between specs. */
export function _resetShutdownForTest(): void {
  hooks.length = 0;
  draining = false;
}
