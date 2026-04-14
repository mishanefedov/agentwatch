import { describe, expect, it } from "vitest";
import { translateSession, translateAudit } from "./openclaw.js";

describe("translateSession", () => {
  it("tags events with agent=openclaw and sub-agent in tool field", () => {
    const sessionStart = {
      type: "session",
      id: "s1",
      timestamp: "2026-04-14T09:00:00.000Z",
      cwd: "/home/u/project",
    };
    const e = translateSession(sessionStart, "content", "s1");
    expect(e?.agent).toBe("openclaw");
    expect(e?.type).toBe("session_start");
    expect(e?.tool).toBe("openclaw:content");
    expect(e?.path).toBe("/home/u/project");
  });

  it("extracts text content from a user message as a prompt", () => {
    const msg = {
      type: "message",
      timestamp: "2026-04-14T09:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "run the heartbeat" }],
      },
    };
    const e = translateSession(msg, "research", "s1");
    expect(e?.type).toBe("prompt");
    expect(e?.tool).toBe("openclaw:research");
    expect(e?.summary).toContain("run the heartbeat");
  });
});

describe("translateAudit", () => {
  it("flags config writes with minimum risk 5 and preserves cwd + argv", () => {
    const audit = {
      ts: "2026-04-14T09:00:02.000Z",
      event: "config.write",
      configPath: "/home/u/.openclaw/openclaw.json",
      cwd: "/home/u/work",
      argv: ["node", "openclaw", "onboard"],
      suspicious: [],
    };
    const e = translateAudit(audit);
    expect(e?.agent).toBe("openclaw");
    expect(e?.type).toBe("file_write");
    expect(e?.riskScore).toBeGreaterThanOrEqual(5);
    expect(e?.cmd).toContain("openclaw onboard");
    expect(e?.summary).toContain("config.write");
  });

  it("bumps risk to 10 when suspicious flags are present", () => {
    const audit = {
      ts: "2026-04-14T09:00:03.000Z",
      event: "config.write",
      configPath: "/home/u/.openclaw/openclaw.json",
      suspicious: ["unexpected mode change"],
    };
    const e = translateAudit(audit);
    expect(e?.riskScore).toBe(10);
  });
});
