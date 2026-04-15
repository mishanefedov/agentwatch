import { describe, expect, it } from "vitest";
import {
  codexSessionsDir,
  translateCodexLine,
  extractTokenUsage,
} from "./codex.js";

describe("extractTokenUsage", () => {
  it("pulls usage out of a token_count event and maps reasoning into output", () => {
    const usage = extractTokenUsage({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 50,
            output_tokens: 20,
            reasoning_output_tokens: 5,
          },
        },
      },
    });
    expect(usage).toEqual({
      input: 100,
      cacheRead: 50,
      cacheCreate: 0,
      output: 25,
    });
  });

  it("returns null for rate-limit-only token_count events (info === null)", () => {
    expect(
      extractTokenUsage({
        type: "event_msg",
        payload: { type: "token_count", info: null },
      }),
    ).toBeNull();
  });

  it("returns null for non-token_count events", () => {
    expect(
      extractTokenUsage({
        type: "event_msg",
        payload: { type: "agent_message" },
      }),
    ).toBeNull();
  });
});

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
