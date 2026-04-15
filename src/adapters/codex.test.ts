import { describe, expect, it } from "vitest";
import { codexSessionsDir, translateCodexLine } from "./codex.js";

describe("codexSessionsDir", () => {
  it("resolves to ~/.codex/sessions", () => {
    expect(codexSessionsDir("/home/u")).toBe("/home/u/.codex/sessions");
  });
});

describe("translateCodexLine", () => {
  it("maps user message → prompt with text + project prefix", () => {
    const e = translateCodexLine(
      {
        timestamp: "2026-04-15T10:00:01Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello codex" }],
        },
      },
      "sess-1",
      "myproj",
    );
    expect(e?.type).toBe("prompt");
    expect(e?.agent).toBe("codex");
    expect(e?.details?.fullText).toBe("hello codex");
    expect(e?.summary).toContain("[myproj]");
  });

  it("maps assistant message → response", () => {
    const e = translateCodexLine(
      {
        timestamp: "2026-04-15T10:00:02Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hi there" }],
        },
      },
      "s",
      "p",
    );
    expect(e?.type).toBe("response");
    expect(e?.details?.fullText).toBe("hi there");
  });

  it("maps exec_command function_call → shell_exec with cmd", () => {
    const e = translateCodexLine(
      {
        timestamp: "2026-04-15T10:00:03Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "ls -la", workdir: "/tmp" }),
        },
      },
      "s",
      "p",
    );
    expect(e?.type).toBe("shell_exec");
    expect(e?.cmd).toBe("ls -la");
    expect(e?.tool).toBe("exec_command");
  });

  it("skips developer messages and unknown types", () => {
    expect(
      translateCodexLine(
        {
          timestamp: "2026-04-15T10:00:00Z",
          type: "response_item",
          payload: { type: "message", role: "developer", content: [] },
        },
        "s",
        "p",
      ),
    ).toBeNull();
    expect(
      translateCodexLine(
        { timestamp: "2026-04-15T10:00:00Z", type: "event_msg", payload: {} },
        "s",
        "p",
      ),
    ).toBeNull();
  });
});
