import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import {
  DAEMON_LABEL,
  logPath,
  pidFilePath,
  plistPath,
  removeServiceUnit,
  startTimeFilePath,
  systemdUnitPath,
  writeServiceUnit,
} from "./install.js";
import { isProcessAlive, runDaemon } from "./run.js";

const HELP = `agentwatch daemon — background event capture

Usage:
  agentwatch daemon start    install + load the user-level service
  agentwatch daemon stop     unload the service (events.db is preserved)
  agentwatch daemon status   running state + uptime + capture stats
  agentwatch daemon logs     tail the daemon log
  agentwatch daemon run      foreground mode (used by launchd / systemd)

Service files:
  macOS:  ~/Library/LaunchAgents/${DAEMON_LABEL}.plist
  Linux:  ~/.config/systemd/user/agentwatch.service

The daemon writes every adapter event to ~/.agentwatch/events.db. The
TUI and \`agentwatch serve\` read the same store, so events captured
overnight are visible the moment you open them.
`;

export async function dispatchDaemon(sub: string | undefined): Promise<void> {
  switch (sub) {
    case undefined:
    case "--help":
    case "-h":
      console.log(HELP);
      process.exit(0);
      return;
    case "start":
      return startCmd();
    case "stop":
      return stopCmd();
    case "status":
      return statusCmd();
    case "logs":
      return logsCmd();
    case "run":
      await runDaemon();
      return;
    default:
      process.stderr.write(`agentwatch daemon: unknown subcommand "${sub}"\n`);
      process.stderr.write(HELP);
      process.exit(2);
  }
}

function startCmd(): void {
  const result = writeServiceUnit();
  console.log(`wrote service unit: ${result.unitPath}`);
  if (platform() === "darwin") {
    runStep(["launchctl", "unload", result.unitPath], { allowFail: true });
    runStep(["launchctl", "load", "-w", result.unitPath]);
    console.log(`daemon loaded — events stream into ~/.agentwatch/events.db`);
    return;
  }
  if (platform() === "linux") {
    runStep(["systemctl", "--user", "daemon-reload"]);
    runStep(["systemctl", "--user", "enable", "--now", "agentwatch.service"]);
    console.log(`daemon enabled + started`);
    return;
  }
  console.log(`unsupported platform; manual steps:`);
  for (const cmd of result.manualSteps) console.log(`  ${cmd}`);
}

function stopCmd(): void {
  if (platform() === "darwin") {
    const path = plistPath();
    if (existsSync(path)) {
      runStep(["launchctl", "unload", path], { allowFail: true });
    }
    const removed = removeServiceUnit();
    console.log(`daemon stopped${removed.unitPath ? ` (removed ${removed.unitPath})` : ""}`);
    return;
  }
  if (platform() === "linux") {
    runStep(["systemctl", "--user", "disable", "--now", "agentwatch.service"], {
      allowFail: true,
    });
    runStep(["systemctl", "--user", "daemon-reload"], { allowFail: true });
    const removed = removeServiceUnit();
    console.log(`daemon stopped${removed.unitPath ? ` (removed ${removed.unitPath})` : ""}`);
    return;
  }
  console.log(`unsupported platform — kill the process manually`);
}

function statusCmd(): void {
  const status = readDaemonStatus();
  if (!status.running) {
    console.log(`daemon: not running`);
    if (status.unitInstalled) console.log(`unit installed at: ${status.unitPath}`);
    process.exit(0);
  }
  console.log(`daemon: running (pid ${status.pid})`);
  console.log(`uptime: ${formatUptime(status.uptimeMs)}`);
  console.log(
    `events captured: ${status.eventsCaptured}` +
      (status.lastEventTs ? ` · last at ${status.lastEventTs}` : ""),
  );
  if (status.unitPath) console.log(`unit: ${status.unitPath}`);
  if (status.dbBytes != null) {
    console.log(`db size: ${(status.dbBytes / 1_048_576).toFixed(1)} MB`);
  }
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptimeMs: number;
  eventsCaptured: number;
  lastEventTs?: string;
  unitInstalled: boolean;
  unitPath?: string;
  dbBytes?: number;
}

export function readDaemonStatus(): DaemonStatus {
  const pidFile = pidFilePath();
  const unitPath =
    platform() === "darwin"
      ? plistPath()
      : platform() === "linux"
        ? systemdUnitPath()
        : undefined;
  const unitInstalled = unitPath ? existsSync(unitPath) : false;

  let pid: number | undefined;
  let uptimeMs = 0;
  if (existsSync(pidFile)) {
    const raw = readFileSync(pidFile, "utf-8").trim();
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0 && isProcessAlive(parsed)) {
      pid = parsed;
    }
  }
  if (pid && existsSync(startTimeFilePath())) {
    const startMs = Number(readFileSync(startTimeFilePath(), "utf-8").trim());
    if (Number.isFinite(startMs)) uptimeMs = Math.max(0, Date.now() - startMs);
  }

  let eventsCaptured = 0;
  let lastEventTs: string | undefined;
  let dbBytes: number | undefined;
  try {
    // Lazy require so a missing better-sqlite3 (rare) doesn't break status.
    const { openStore } = require("../store/sqlite.js") as typeof import("../store/sqlite.js");
    const store = openStore();
    const stats = store.stats();
    eventsCaptured = stats.events;
    dbBytes = stats.dbBytes;
    const sessions = store.listSessions({ limit: 1 });
    lastEventTs = sessions[0]?.lastTs;
    store.close();
  } catch {
    // store unreachable; report what we know
  }

  return {
    running: pid != null,
    ...(pid != null ? { pid } : {}),
    uptimeMs,
    eventsCaptured,
    ...(lastEventTs ? { lastEventTs } : {}),
    unitInstalled,
    ...(unitPath ? { unitPath } : {}),
    ...(dbBytes != null ? { dbBytes } : {}),
  };
}

function logsCmd(): void {
  const path = logPath();
  if (!existsSync(path)) {
    console.log(`(no log yet at ${path})`);
    return;
  }
  // Use tail -f if available; fall back to printing the file.
  const tail = spawnSync("tail", ["-n", "200", "-f", path], {
    stdio: "inherit",
  });
  if (tail.error) {
    process.stdout.write(readFileSync(path, "utf-8"));
  }
}

function runStep(
  argv: string[],
  opts: { allowFail?: boolean } = {},
): void {
  const [cmd, ...rest] = argv;
  if (!cmd) return;
  const result = spawnSync(cmd, rest, { stdio: "inherit" });
  if (result.error) {
    if (opts.allowFail) return;
    throw new Error(`spawn ${cmd}: ${String(result.error)}`);
  }
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(`${argv.join(" ")} exited ${result.status}`);
  }
}

function formatUptime(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${d}d ${h}h`;
}
