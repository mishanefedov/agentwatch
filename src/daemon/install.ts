import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";

export const DAEMON_LABEL = "com.agentwatch.daemon";

export interface DaemonExec {
  /** Absolute path to the node binary that should run the daemon. */
  node: string;
  /** Absolute path to the agentwatch entry script (bin/agentwatch.js or src/index.tsx). */
  script: string;
}

export function resolveAgentwatchExec(): DaemonExec {
  return {
    node: process.execPath,
    script: resolve(process.argv[1] ?? ""),
  };
}

export function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
}

export function systemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", "agentwatch.service");
}

export function logPath(): string {
  return join(homedir(), ".agentwatch", "daemon.log");
}

export function pidFilePath(): string {
  return join(homedir(), ".agentwatch", "daemon.pid");
}

export function startTimeFilePath(): string {
  return join(homedir(), ".agentwatch", "daemon.started_at");
}

export function renderPlist(exec: DaemonExec, log: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${exec.node}</string>
    <string>${exec.script}</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>
`;
}

export function renderSystemdUnit(exec: DaemonExec, log: string): string {
  return `[Unit]
Description=agentwatch event capture daemon
After=network-online.target

[Service]
Type=simple
ExecStart=${exec.node} ${exec.script} daemon run
Restart=on-failure
RestartSec=5
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`;
}

export interface InstallResult {
  unitPath: string;
  /** Shell commands the operator should run if our spawn() failed (e.g.
   *  no launchctl on PATH). Empty when the install fully succeeded. */
  manualSteps: string[];
}

export function writeServiceUnit(): InstallResult {
  const exec = resolveAgentwatchExec();
  const log = logPath();
  mkdirSync(join(homedir(), ".agentwatch"), { recursive: true });
  if (platform() === "darwin") {
    const path = plistPath();
    mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(path, renderPlist(exec, log), "utf-8");
    return {
      unitPath: path,
      manualSteps: [`launchctl load -w ${path}`],
    };
  }
  if (platform() === "linux") {
    const path = systemdUnitPath();
    mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
    writeFileSync(path, renderSystemdUnit(exec, log), "utf-8");
    return {
      unitPath: path,
      manualSteps: [
        "systemctl --user daemon-reload",
        "systemctl --user enable --now agentwatch.service",
      ],
    };
  }
  throw new Error(
    `agentwatch daemon: unsupported platform "${platform()}" (Windows is on the v0.2 roadmap)`,
  );
}

export function removeServiceUnit(): { unitPath: string | null } {
  const path = platform() === "darwin"
    ? plistPath()
    : platform() === "linux"
      ? systemdUnitPath()
      : null;
  if (!path) return { unitPath: null };
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // best effort
    }
  }
  return { unitPath: path };
}
