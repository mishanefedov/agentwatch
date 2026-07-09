import { describe, expect, it } from "vitest";
import { extractGeminiUsage, translateGeminiDoc } from "./gemini.js";

describe("extractGeminiUsage", () => {
  it("subtracts cached from total input to get fresh input", () => {
    const u = extractGeminiUsage({
      tokens: { input: 5000, output: 120, cached: 2000, thoughts: 0, tool: 0 },
    });
    expect(u).toEqual({
      input: 3000,
      cacheCreate: 0,
      cacheRead: 2000,
      output: 120,
    });
  });

  it("folds thoughts and tool tokens into output", () => {
    const u = extractGeminiUsage({
      tokens: {
        input: 1000,
        output: 10,
        cached: 0,
        thoughts: 50,
        tool: 5,
      },
    });
    expect(u?.output).toBe(65);
  });

  it("returns null when no tokens object is present", () => {
    expect(extractGeminiUsage({})).toBeNull();
  });

  it("returns null when every token field is zero", () => {
    expect(
      extractGeminiUsage({
        tokens: { input: 0, output: 0, cached: 0, thoughts: 0, tool: 0 },
      }),
    ).toBeNull();
  });
});

describe("translateGeminiDoc", () => {
  // Shape mirrors ~/.gemini/tmp/<project>/chats/session-<ts>-<hash>.json —
  // this is the same document the MCP server's parseGeminiSession reads
  // (single JSON, not JSONL) and the live adapter tails incrementally.
  const doc = {
    sessionId: "abc123",
    kind: "main",
    messages: [
      {
        id: "m1",
        timestamp: "2026-01-01T00:00:00.000Z",
        type: "user",
        content: [{ text: "read config.json and summarize it" }],
      },
      {
        id: "m2",
        timestamp: "2026-01-01T00:00:01.000Z",
        type: "gemini",
        content: [{ text: "Reading the file now." }],
        tokens: { input: 5000, output: 120, cached: 2000, thoughts: 30, tool: 0 },
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            args: { file_path: "config.json" },
            result: [
              { functionResponse: { response: { output: '{"ok":true}' } } },
            ],
          },
          {
            id: "call-2",
            name: "run_shell_command",
            args: { command: "ls -la" },
            result: [
              {
                functionResponse: {
                  response: { error: "permission denied" },
                },
              },
            ],
          },
        ],
      },
    ],
  };

  it("translates prompt and response events in order", () => {
    const events = translateGeminiDoc(doc, "session-abc", "myproject");
    expect(events[0]).toMatchObject({
      agent: "gemini",
      type: "prompt",
      sessionId: "session-abc",
    });
    expect(events[0].summary).toContain("config.json");
    expect(events[1]).toMatchObject({ agent: "gemini", type: "response" });
  });

  it("translates inline toolCalls into per-tool events with results", () => {
    const events = translateGeminiDoc(doc, "session-abc", "myproject");
    const toolEvents = events.filter((e) => e.type !== "prompt" && e.type !== "response");
    expect(toolEvents).toHaveLength(2);

    const readEvent = toolEvents.find((e) => e.tool === "gemini:read_file");
    expect(readEvent).toMatchObject({
      type: "file_read",
      path: "config.json",
      sessionId: "session-abc",
    });
    expect(readEvent?.details?.toolResult).toContain("ok");
    expect(readEvent?.details?.toolError).toBeUndefined();

    const shellEvent = toolEvents.find((e) => e.tool === "gemini:run_shell_command");
    expect(shellEvent).toMatchObject({
      type: "shell_exec",
      cmd: "ls -la",
    });
    expect(shellEvent?.details?.toolError).toBe(true);
  });

  it("carries usage + computed USD cost on the response event", () => {
    const events = translateGeminiDoc(doc, "session-abc", "myproject");
    const response = events.find((e) => e.type === "response");
    expect(response?.details?.usage).toEqual({
      input: 3000,
      cacheCreate: 0,
      cacheRead: 2000,
      output: 150,
    });
    expect(response?.details?.model).toBe("gemini-2.5-pro");
    // gemini-2.5-pro rates: input 1.25, cacheRead 0.31, output 10.0 per 1M.
    const expectedCost =
      (3000 * 1.25 + 2000 * 0.31 + 150 * 10.0) / 1_000_000;
    expect(response?.details?.cost).toBeCloseTo(expectedCost, 10);
  });

  it("returns [] for a document with no messages", () => {
    expect(translateGeminiDoc({}, "s", "p")).toEqual([]);
    expect(translateGeminiDoc({ messages: [] }, "s", "p")).toEqual([]);
  });
});
