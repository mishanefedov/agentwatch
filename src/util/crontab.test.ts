import { describe, expect, it, vi } from "vitest";
import { parseCrontab, readCrontab } from "./crontab.js";

describe("parseCrontab", () => {
  it("parses a standard 5-field schedule + command", () => {
    const entries = parseCrontab("23 8 * * * /Users/me/script.sh >> /tmp/log 2>&1\n");
    expect(entries).toEqual([
      {
        schedule: "23 8 * * *",
        command: "/Users/me/script.sh >> /tmp/log 2>&1",
        raw: "23 8 * * * /Users/me/script.sh >> /tmp/log 2>&1",
        agentTag: false,
      },
    ]);
  });

  it("parses @keyword shorthand schedules", () => {
    const entries = parseCrontab("@daily /Users/me/backup.sh\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ schedule: "@daily", command: "/Users/me/backup.sh" });
  });

  it("skips comments and blank lines", () => {
    const text = "# a comment\n\n   \n23 8 * * * /bin/true\n";
    expect(parseCrontab(text)).toHaveLength(1);
  });

  it("skips env-var assignment lines", () => {
    const text = 'PATH=/usr/bin:/bin\nMAILTO=""\n0 * * * * /bin/true\n';
    const entries = parseCrontab(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.command).toBe("/bin/true");
  });

  it("flags commands that mention a known agent", () => {
    const entries = parseCrontab("0 9 * * * /usr/local/bin/claude -p 'daily digest'\n");
    expect(entries[0]!.agentTag).toBe(true);
  });

  it("does not flag ordinary system commands", () => {
    const entries = parseCrontab("0 3 * * * /usr/bin/find /tmp -mtime +7 -delete\n");
    expect(entries[0]!.agentTag).toBe(false);
  });

  it("returns [] for empty input", () => {
    expect(parseCrontab("")).toEqual([]);
  });
});

describe("readCrontab", () => {
  it("calls `crontab -l` and parses the result", () => {
    const fakeExec = vi.fn((cmd: string, args: string[]) => {
      expect(cmd).toBe("crontab");
      expect(args).toEqual(["-l"]);
      return "0 9 * * * /bin/true\n";
    });
    expect(readCrontab(fakeExec)).toHaveLength(1);
  });

  it("returns [] when crontab -l exits non-zero (no crontab installed)", () => {
    const fakeExec = vi.fn(() => {
      throw new Error("crontab: no crontab for user");
    });
    expect(readCrontab(fakeExec)).toEqual([]);
  });
});
