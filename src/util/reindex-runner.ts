import { buildSemanticIndex } from "./semantic-builder.js";
import {
  claimReindexLock,
  writeReindexMeta,
  type ReindexStatus,
} from "./semantic-index.js";

/**
 * The actual `agentwatch reindex` work — runs standalone in a detached
 * subprocess (spawned via reindex-spawner.ts) so it never shares an event
 * loop with the TUI's Ink input handler or the web server. Progress is
 * written to the index.sqlite `reindex_meta` row as it goes; any process
 * (TUI footer, web search route) can poll `readReindexMeta()` to show it.
 *
 * `runReindex` is the testable core (takes an injectable AbortSignal).
 * `runReindexCli` wires that signal to real OS signals for the actual CLI
 * entry point — kept separate so tests never have to send a real SIGINT.
 */

export interface ReindexResult {
  code: number;
  message: string;
  status: ReindexStatus;
}

export async function runReindex(
  opts: { signal?: AbortSignal; quiet?: boolean } = {},
): Promise<ReindexResult> {
  const claim = claimReindexLock();
  if (!claim.acquired) {
    const message = `reindex already running (pid ${claim.meta.pid ?? "?"}) — skipping duplicate build`;
    log(opts, message);
    return { code: 0, message, status: claim.meta.status };
  }

  let cancelled = false;
  const signal = opts.signal;
  const onAbort = (): void => {
    cancelled = true;
  };
  signal?.addEventListener("abort", onAbort);

  try {
    const progress = await buildSemanticIndex({
      ...(signal ? { signal } : {}),
      onProgress: (p) => {
        writeReindexMeta({
          status: "running",
          scannedFiles: p.scannedFiles,
          queuedTurns: p.queuedTurns,
          embeddedTurns: p.embeddedTurns,
          skippedTurns: p.skippedTurns,
          updatedAt: new Date().toISOString(),
        });
      },
    });
    const status: ReindexStatus = cancelled || signal?.aborted ? "cancelled" : "done";
    writeReindexMeta({
      status,
      scannedFiles: progress.scannedFiles,
      queuedTurns: progress.queuedTurns,
      embeddedTurns: progress.embeddedTurns,
      skippedTurns: progress.skippedTurns,
      updatedAt: new Date().toISOString(),
      error: null,
    });
    const message =
      status === "cancelled"
        ? `reindex cancelled after embedding ${progress.embeddedTurns}/${progress.queuedTurns} turns (db left consistent)`
        : `reindex complete: ${progress.embeddedTurns} embedded, ${progress.scannedFiles} files scanned`;
    log(opts, message);
    return { code: status === "cancelled" ? 130 : 0, message, status };
  } catch (err) {
    const message = `reindex failed: ${String(err)}`;
    writeReindexMeta({
      status: "error",
      error: message.slice(0, 500),
      updatedAt: new Date().toISOString(),
    });
    log(opts, message, true);
    return { code: 1, message, status: "error" };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Real CLI entry point — wires SIGINT/SIGTERM to an AbortSignal so
 *  Ctrl-C (or a TUI-issued SIGTERM) cancels the build cleanly instead of
 *  killing it mid-write. Batches are committed transactionally in
 *  semantic-builder.ts, so even a hard kill only ever loses the
 *  in-flight (uncommitted) batch — the db is never left partially
 *  written. */
export async function runReindexCli(
  opts: { quiet?: boolean } = {},
): Promise<ReindexResult> {
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await runReindex({ signal: controller.signal, quiet: opts.quiet });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

function log(opts: { quiet?: boolean }, message: string, isError = false): void {
  if (opts.quiet) return;
  if (isError) {
    // eslint-disable-next-line no-console
    console.error(`[agentwatch] ${message}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[agentwatch] ${message}`);
  }
}
