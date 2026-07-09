import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverLaunchAgentFiles,
  getLaunchdHealth,
  parsePlistXml,
  readLaunchdAgents,
  readPlistFile,
} from "./launchd-agents.js";

const XML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">`;

function wrap(dict: string): string {
  return `${XML_HEADER}\n<dict>\n${dict}\n</dict>\n</plist>`;
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const orig = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: orig });
  }
}

const tmpDirs: string[] = [];
function mkTmpDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("parsePlistXml", () => {
  it("parses scalars, arrays, and nested dicts", () => {
    const xml = wrap(`
      <key>Label</key>
      <string>com.example.agent</string>
      <key>RunAtLoad</key>
      <true/>
      <key>KeepAlive</key>
      <false/>
      <key>ProgramArguments</key>
      <array>
        <string>/usr/bin/node</string>
        <string>/path/to/script.js</string>
      </array>
      <key>StartCalendarInterval</key>
      <dict>
        <key>Hour</key>
        <integer>8</integer>
        <key>Minute</key>
        <integer>23</integer>
      </dict>
    `);
    expect(parsePlistXml(xml)).toMatchObject({
      Label: "com.example.agent",
      RunAtLoad: true,
      KeepAlive: false,
      ProgramArguments: ["/usr/bin/node", "/path/to/script.js"],
      StartCalendarInterval: { Hour: 8, Minute: 23 },
    });
  });

  it("returns {} when there's no top-level dict", () => {
    expect(parsePlistXml("<plist/>")).toEqual({});
  });
});

describe("readPlistFile", () => {
  it("parses XML plists in-process without shelling out", () => {
    const tmp = mkTmpDir("plist-xml-");
    const file = path.join(tmp, "com.example.plist");
    fs.writeFileSync(file, wrap(`<key>Label</key><string>com.example.agent</string>`));
    const fakeExec = vi.fn(() => {
      throw new Error("should not shell out for a text plist");
    });
    expect(readPlistFile(file, fakeExec)).toMatchObject({ Label: "com.example.agent" });
    expect(fakeExec).not.toHaveBeenCalled();
  });

  it("shells out to plutil -convert xml1 for binary-encoded plists", () => {
    const tmp = mkTmpDir("plist-bin-");
    const file = path.join(tmp, "com.example.plist");
    fs.writeFileSync(file, Buffer.concat([Buffer.from("bplist00", "utf8"), Buffer.from([0, 1, 2, 3])]));
    const fakeExec = vi.fn((cmd: string, args: string[]) => {
      expect(cmd).toBe("plutil");
      expect(args).toEqual(["-convert", "xml1", "-o", "-", file]);
      return wrap(`<key>Label</key><string>com.example.agent</string>`);
    });
    expect(readPlistFile(file, fakeExec)).toMatchObject({ Label: "com.example.agent" });
    expect(fakeExec).toHaveBeenCalledTimes(1);
  });

  it("returns null when the file doesn't exist", () => {
    expect(readPlistFile("/tmp/does-not-exist-agentwatch.plist")).toBeNull();
  });

  it("returns null when plutil fails", () => {
    const tmp = mkTmpDir("plist-bin-fail-");
    const file = path.join(tmp, "bad.plist");
    fs.writeFileSync(file, Buffer.from("bplist00\x00\x01"));
    const fakeExec = vi.fn(() => {
      throw new Error("plutil: corrupt");
    });
    expect(readPlistFile(file, fakeExec)).toBeNull();
  });
});

describe("getLaunchdHealth", () => {
  it("reports running with pid + lastExitStatus from launchctl list output", () => {
    withPlatform("darwin", () => {
      const out = `{\n\t"PID" = 12600;\n\t"LastExitStatus" = 9;\n\t"Label" = "com.example";\n};`;
      const fakeExec = vi.fn(() => out);
      expect(getLaunchdHealth("com.example", fakeExec)).toEqual({
        loaded: true,
        running: true,
        pid: 12600,
        lastExitStatus: 9,
      });
    });
  });

  it("treats a non-zero exit (job not loaded) as not running, not an error", () => {
    withPlatform("darwin", () => {
      const fakeExec = vi.fn(() => {
        throw new Error('Could not find service "com.missing" in domain for port');
      });
      expect(getLaunchdHealth("com.missing", fakeExec)).toEqual({ loaded: false, running: false });
    });
  });

  it("returns not-loaded on non-macOS without calling exec", () => {
    withPlatform("linux", () => {
      const fakeExec = vi.fn(() => "should not be called");
      expect(getLaunchdHealth("com.example", fakeExec)).toEqual({ loaded: false, running: false });
      expect(fakeExec).not.toHaveBeenCalled();
    });
  });
});

describe("readLaunchdAgents", () => {
  it("discovers plists, derives schedule + agent tag, and joins launchctl health", () => {
    withPlatform("darwin", () => {
      const home = mkTmpDir("home-");
      const dir = path.join(home, "Library", "LaunchAgents");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "com.example.claude-daily.plist"),
        wrap(`
          <key>Label</key>
          <string>com.example.claude-daily</string>
          <key>ProgramArguments</key>
          <array>
            <string>/usr/local/bin/claude</string>
            <string>run</string>
          </array>
          <key>StartCalendarInterval</key>
          <dict>
            <key>Hour</key>
            <integer>8</integer>
            <key>Minute</key>
            <integer>0</integer>
          </dict>
        `),
      );
      const fakeExec = vi.fn((cmd: string) => {
        if (cmd === "launchctl") return `{ "PID" = 500; "LastExitStatus" = 0; };`;
        throw new Error(`unexpected exec: ${cmd}`);
      });
      const agents = readLaunchdAgents(home, fakeExec);
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        label: "com.example.claude-daily",
        program: "/usr/local/bin/claude",
        schedule: "daily at 08:00",
        scheduleKind: "calendar",
        running: true,
        pid: 500,
        lastExitStatus: 0,
        agentTag: true,
      });
    });
  });

  it("describes StartInterval and RunAtLoad-only and manual schedules", () => {
    withPlatform("darwin", () => {
      const home = mkTmpDir("home-schedules-");
      const dir = path.join(home, "Library", "LaunchAgents");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "com.example.interval.plist"),
        wrap(`
          <key>Label</key>
          <string>com.example.interval</string>
          <key>Program</key>
          <string>/usr/bin/backup</string>
          <key>StartInterval</key>
          <integer>300</integer>
        `),
      );
      fs.writeFileSync(
        path.join(dir, "com.example.onload.plist"),
        wrap(`
          <key>Label</key>
          <string>com.example.onload</string>
          <key>Program</key>
          <string>/usr/bin/watcher</string>
          <key>RunAtLoad</key>
          <true/>
        `),
      );
      fs.writeFileSync(
        path.join(dir, "com.example.manual.plist"),
        wrap(`
          <key>Label</key>
          <string>com.example.manual</string>
          <key>Program</key>
          <string>/usr/bin/manual-thing</string>
        `),
      );
      const fakeExec = vi.fn((cmd: string) => {
        if (cmd === "launchctl") throw new Error("not loaded");
        throw new Error(`unexpected exec: ${cmd}`);
      });
      const agents = readLaunchdAgents(home, fakeExec);
      const byLabel = Object.fromEntries(agents.map((a) => [a.label, a]));
      expect(byLabel["com.example.interval"]).toMatchObject({
        schedule: "every 5m",
        scheduleKind: "interval",
        agentTag: false,
      });
      expect(byLabel["com.example.onload"]).toMatchObject({
        schedule: "on load",
        scheduleKind: "onload",
      });
      expect(byLabel["com.example.manual"]).toMatchObject({
        schedule: "manual",
        scheduleKind: "unknown",
        loaded: false,
        running: false,
      });
    });
  });

  it("returns [] on non-macOS regardless of fixture files", () => {
    withPlatform("linux", () => {
      expect(readLaunchdAgents("/tmp/whatever-agentwatch-home")).toEqual([]);
    });
  });
});

describe("discoverLaunchAgentFiles", () => {
  it("returns [] on non-macOS", () => {
    withPlatform("linux", () => {
      expect(discoverLaunchAgentFiles("/tmp/whatever-agentwatch-home")).toEqual([]);
    });
  });

  it("returns [] when the LaunchAgents directory doesn't exist", () => {
    withPlatform("darwin", () => {
      const home = mkTmpDir("home-empty-");
      expect(discoverLaunchAgentFiles(home)).toEqual([]);
    });
  });
});
