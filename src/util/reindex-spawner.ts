import { spawn } from "node:child_process";
import { isPidAlive, type ReindexMeta } from "./semantic-index.js";

/**
 * Launches `agentwatch reindex` as a detached, fully independent process —
 * not a worker_thread, not an inline call. It re-execs the same
 * interpreter + entry script the current process was started with (so it
 * works identically under the built `dist/index.js` and under `tsx
 * src/index.tsx` in dev), then severs the parent/child relationship with
 * `detached: true` + `unref()` so the TUI exiting doesn't kill an
 * in-flight build, and `stdio: 'ignore'` so it never contends for the
 * parent's stdout/stdin (which Ink owns).
 */
export function spawnDetachedReindex(): void {
  const command = process.execPath;
  const args = [...process.execArgv, process.argv[1] ?? "", "reindex"];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

const STALE_MS = 15 * 60 * 1000;

/** Decide whether a background build is worth kicking off: never while one
 *  is already running, always on first run (no index / empty index yet),
 *  and periodically afterward so new turns get embedded incrementally
 *  without the caller having to track "since last build" itself. */
export function shouldSpawnReindex(
  meta: ReindexMeta,
  hasIdx: boolean,
  vectors: number,
): boolean {
  if (meta.status === "running" && meta.pid != null && isPidAlive(meta.pid)) {
    return false;
  }
  if (!hasIdx || vectors === 0) return true;
  if (!meta.updatedAt) return true;
  const updatedMs = Date.parse(meta.updatedAt);
  if (Number.isNaN(updatedMs)) return true;
  return Date.now() - updatedMs > STALE_MS;
}

/** Cancel an in-flight reindex. Returns false if there's no live pid to
 *  signal (nothing running, or it already exited). */
export function cancelReindex(meta: ReindexMeta): boolean {
  if (meta.pid == null || !isPidAlive(meta.pid)) return false;
  try {
    process.kill(meta.pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
