import { describe, expect, it } from "vitest";
import { translateClaudeLine } from "./claude-code.js";

describe("translateClaudeLine", () => {
  it("emits a prompt event for a user message", () => {
    const line = {
      type: "user",
      timestamp: "2026-04-14T10:00:00.000Z",
      message: { role: "user", content: "help me debug this" },
    };
    const e = translateClaudeLine(line, "sess-1");
    expect(e?.type).toBe("prompt");
    expect(e?.agent).toBe("claude-code");
    expect(e?.sessionId).toBe("sess-1");
    expect(e?.summary).toContain("help me debug");
  });

  it("emits shell_exec with elevated risk for a Bash tool_use", () => {
    const line = {
      type: "assistant",
      timestamp: "2026-04-14T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Bash", input: { command: "rm -rf /tmp/x" } },
        ],
      },
    };
    const e = translateClaudeLine(line, "sess-1");
    expect(e?.type).toBe("shell_exec");
    expect(e?.agent).toBe("claude-code");
    expect(e?.tool).toBe("Bash");
    expect(e?.cmd).toBe("rm -rf /tmp/x");
    expect(e?.summary).toContain("Bash: rm -rf /tmp/x");
    expect(e?.riskScore).toBeGreaterThanOrEqual(9);
  });

  it("suppresses empty assistant messages", () => {
    const line = {
      type: "assistant",
      timestamp: "2026-04-14T10:00:05.000Z",
      message: { role: "assistant", content: [] },
    };
    expect(translateClaudeLine(line, "sess-1")).toBeNull();
  });

  it("emits a response for an assistant text message", () => {
    const line = {
      type: "assistant",
      timestamp: "2026-04-14T10:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "here is the answer" }],
      },
    };
    const e = translateClaudeLine(line, "sess-1");
    expect(e?.type).toBe("response");
    expect(e?.summary).toContain("here is the answer");
  });

  it("returns null for tool_result noise", () => {
    expect(translateClaudeLine({ type: "tool_result" }, "sess-1")).toBeNull();
    expect(translateClaudeLine({ type: "summary" }, "sess-1")).toBeNull();
  });
});
