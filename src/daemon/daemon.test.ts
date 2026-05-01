import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DAEMON_LABEL,
  renderPlist,
  renderSystemdUnit,
  resolveAgentwatchExec,
} from "./install.js";
import { RotatingLogStream } from "./log-rotate.js";
import { isProcessAlive } from "./run.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentwatch-daemon-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("daemon — log rotation", () => {
  it("appends to a fresh log file", () => {
    const path = join(dir, "log");
    const log = new RotatingLogStream({ path, maxBytes: 1024 });
    log.write("hello");
    log.write("world");
    log.close();
    const content = readFileSync(path, "utf-8");
    expect(content).toBe("hello\nworld\n");
  });

  it("rotates when the next write would exceed maxBytes", () => {
    const path = join(dir, "log");
    const log = new RotatingLogStream({ path, maxBytes: 50 });
    log.write("x".repeat(40)); // 41 bytes including trailing newline
    log.write("y".repeat(40)); // would push us past 50 → rotate first
    log.close();
    expect(existsSync(`${path}.1`)).toBe(true);
    const main = readFileSync(path, "utf-8");
    const rotated = readFileSync(`${path}.1`, "utf-8");
    expect(rotated).toContain("x".repeat(40));
    expect(main).toContain("y".repeat(40));
    expect(main.length).toBeLessThan(50);
  });

  it("creates the parent directory if missing", () => {
    const nested = join(dir, "nested", "deeper", "log");
    const log = new RotatingLogStream({ path: nested });
    log.write("ok");
    log.close();
    expect(existsSync(nested)).toBe(true);
  });

  it("survives a re-open by appending, not truncating", () => {
    const path = join(dir, "log");
    let log = new RotatingLogStream({ path });
    log.write("first");
    log.close();
    log = new RotatingLogStream({ path });
    log.write("second");
    log.close();
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("first");
    expect(content).toContain("second");
    expect(content.indexOf("first")).toBeLessThan(content.indexOf("second"));
  });
});

describe("daemon — service unit rendering", () => {
  it("renders a launchd plist with the daemon label and four-arg ProgramArguments", () => {
    const plist = renderPlist(
      { node: "/usr/local/bin/node", script: "/opt/agentwatch/bin/agentwatch.js" },
      "/Users/x/.agentwatch/daemon.log",
    );
    expect(plist).toContain(`<string>${DAEMON_LABEL}</string>`);
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain(
      "<string>/opt/agentwatch/bin/agentwatch.js</string>",
    );
    expect(plist).toContain("<string>daemon</string>");
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain(
      "<string>/Users/x/.agentwatch/daemon.log</string>",
    );
  });

  it("renders a systemd unit with simple type, restart-on-failure, and log redirect", () => {
    const unit = renderSystemdUnit(
      { node: "/usr/bin/node", script: "/opt/agentwatch/bin/agentwatch.js" },
      "/home/x/.agentwatch/daemon.log",
    );
    expect(unit).toContain("Description=agentwatch event capture daemon");
    expect(unit).toContain("Type=simple");
    expect(unit).toContain(
      "ExecStart=/usr/bin/node /opt/agentwatch/bin/agentwatch.js daemon run",
    );
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
    expect(unit).toContain(
      "StandardOutput=append:/home/x/.agentwatch/daemon.log",
    );
  });

  it("resolveAgentwatchExec uses process.execPath + argv[1]", () => {
    const exec = resolveAgentwatchExec();
    expect(exec.node).toBe(process.execPath);
    expect(exec.script.length).toBeGreaterThan(0);
  });
});

describe("daemon — process liveness probe", () => {
  it("reports the current process as alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("reports a definitely-dead pid as not alive", () => {
    // PID 0 is reserved (kernel scheduler) — process.kill rejects it.
    // Use a high pid that's almost certainly unused.
    expect(isProcessAlive(2_000_000_000)).toBe(false);
  });
});

describe("daemon — log file size budget", () => {
  it("never grows the active log past maxBytes by more than one line", () => {
    const path = join(dir, "log");
    const log = new RotatingLogStream({ path, maxBytes: 200 });
    for (let i = 0; i < 50; i++) log.write(`line ${i} `.repeat(5));
    log.close();
    const size = statSync(path).size;
    // After the last rotation, the active file holds only writes that
    // came post-rotation. Bound is one full line over the cap.
    expect(size).toBeLessThan(400);
  });
});
