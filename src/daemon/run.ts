import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import { logPath, pidFilePath, startTimeFilePath } from "./install.js";
import { RotatingLogStream } from "./log-rotate.js";
import type { AgentEvent, EventDetails, EventSink } from "../schema.js";
import { clampTs } from "../schema.js";

/** Run the daemon as a foreground process. The launchd plist / systemd
 *  unit invokes `agentwatch daemon run` and treats this as the long-
 *  running supervised process; KeepAlive / Restart handles crash loops.
 *
 *  Responsibilities here:
 *    1. Open the SQLite store
 *    2. Start every adapter wired through wrapSinkWithStore so events
 *       persist on disk
 *    3. Write our PID + start time so `daemon status` can read them
 *    4. Drain on SIGTERM / SIGINT — close adapters, close store
 *    5. Stay alive until signaled
 *
 *  No TUI, no web server, no notifications. The TUI and `agentwatch
 *  serve` are clients of the same SQLite store; they observe daemon-
 *  written events transparently. */
export async function runDaemon(): Promise<void> {
  const dataDir = join(homedir(), ".agentwatch");
  mkdirSync(dataDir, { recursive: true });

  const lock = acquireLock();
  if (!lock.ok) {
    process.stderr.write(
      `[agentwatch daemon] another instance is already running (pid ${lock.existingPid}). Exiting.\n`,
    );
    process.exit(2);
  }

  const log = new RotatingLogStream({ path: logPath() });
  const logLine = (msg: string): void => {
    log.write(`${new Date().toISOString()} ${msg}`);
  };
  logLine(`daemon starting (pid ${process.pid})`);

  let store: import("../store/sqlite.js").EventStore | null = null;
  let stoppingHooks: Array<() => Promise<void> | void> = [];

  try {
    const { openStore, wrapSinkWithStore } = await import("../store/index.js");
    const { startAllAdapters, stopAllAdapters } = await import(
      "../adapters/registry.js"
    );
    const { detectWorkspaceRoot } = await import("../util/workspace.js");

    store = openStore();
    const workspace = detectWorkspaceRoot();

    let captured = 0;
    const inner: EventSink = {
      emit: (e: AgentEvent) => {
        e.ts = clampTs(e.ts);
        captured += 1;
      },
      enrich: (_id: string, _patch: Partial<EventDetails>) => {
        // Daemon-side enrich is purely a store update — handled by the
        // wrapper; nothing additional to do here.
      },
    };
    const sink = wrapSinkWithStore(inner, store);
    const adapters = startAllAdapters(sink, workspace);
    stoppingHooks.push(() => stopAllAdapters(adapters));
    stoppingHooks.push(() => store?.close());

    logLine(`adapters started; workspace=${workspace}`);

    // Periodic heartbeat to the log so operators can confirm the daemon
    // is healthy without parsing PID-state. Once a minute is enough.
    const heartbeat = setInterval(() => {
      logLine(`heartbeat captured=${captured}`);
    }, 60_000);
    heartbeat.unref();
    stoppingHooks.push(() => clearInterval(heartbeat));

    setupShutdown(stoppingHooks, log, lock.releaseLock);

    // Block forever — adapters keep the event loop alive via their
    // chokidar watchers. We add a never-resolving promise as a belt and
    // suspenders so an adapter shutting down cleanly doesn't drop us.
    await new Promise<void>(() => undefined);
  } catch (err) {
    logLine(`fatal: ${String(err)}`);
    for (const hook of stoppingHooks) {
      try {
        await hook();
      } catch {
        // best effort
      }
    }
    lock.releaseLock();
    log.close();
    process.exit(1);
  }
}

interface LockHandle {
  ok: boolean;
  existingPid?: number;
  releaseLock: () => void;
}

function acquireLock(): LockHandle {
  const pidFile = pidFilePath();
  const startFile = startTimeFilePath();
  if (existsSync(pidFile)) {
    const raw = readFileSync(pidFile, "utf-8").trim();
    const pid = Number(raw);
    if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) {
      return { ok: false, existingPid: pid, releaseLock: () => undefined };
    }
    // Stale PID file — remove it and continue.
    try {
      unlinkSync(pidFile);
    } catch {
      // best effort
    }
  }
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, String(process.pid), "utf-8");
  writeFileSync(startFile, String(Date.now()), "utf-8");
  return {
    ok: true,
    releaseLock: () => {
      try {
        unlinkSync(pidFile);
      } catch {
        // best effort
      }
      try {
        unlinkSync(startFile);
      } catch {
        // best effort
      }
    },
  };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we can't signal it — still alive.
    if (code === "EPERM") return true;
    return false;
  }
}

function setupShutdown(
  hooks: Array<() => Promise<void> | void>,
  log: RotatingLogStream,
  releaseLock: () => void,
): void {
  let shutting = false;
  const stop = async (sig: string): Promise<void> => {
    if (shutting) return;
    shutting = true;
    log.write(
      `${new Date().toISOString()} shutdown signal=${sig} draining ${hooks.length} hooks\n`,
    );
    for (const hook of hooks) {
      try {
        await hook();
      } catch (err) {
        log.write(
          `${new Date().toISOString()} shutdown hook error: ${String(err)}\n`,
        );
      }
    }
    releaseLock();
    log.write(`${new Date().toISOString()} daemon stopped cleanly\n`);
    log.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGHUP", () => void stop("SIGHUP"));
}
