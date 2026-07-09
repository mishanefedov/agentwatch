import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession, type SessionRef } from "./server.js";

/**
 * AUR-3: `parseSession` is the shared read-path behind the
 * `get_tool_usage_stats` and `get_session_cost` MCP tools. This exercises
 * the Gemini branch specifically — it used to return `[]` unconditionally
 * (see git history), which made both tools report honest-but-fake zeroes
 * for every Gemini session. It now delegates to the same
 * `translateGeminiDoc` pure function the live adapter uses, so real
 * per-tool counts and real token/cost totals come out the other end.
 */
describe("parseSession — gemini", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function writeGeminiSession(doc: unknown): string {
    dir = mkdtempSync(join(tmpdir(), "agentwatch-gemini-mcp-"));
    const file = join(dir, "session-2026-01-01T00-00-00-abc123.json");
    writeFileSync(file, JSON.stringify(doc));
    return file;
  }

  const baseDoc = {
    sessionId: "abc123",
    kind: "main",
    messages: [
      {
        id: "m1",
        timestamp: "2026-01-01T00:00:00.000Z",
        type: "user",
        content: [{ text: "list files and read the config" }],
      },
      {
        id: "m2",
        timestamp: "2026-01-01T00:00:01.000Z",
        type: "gemini",
        content: [{ text: "On it." }],
        tokens: { input: 4000, output: 200, cached: 1000, thoughts: 0, tool: 0 },
        toolCalls: [
          {
            id: "call-1",
            name: "run_shell_command",
            args: { command: "ls" },
            result: [{ functionResponse: { response: { output: "a.txt\nb.txt" } } }],
          },
          {
            id: "call-2",
            name: "read_file",
            args: { file_path: "config.json" },
            result: [{ functionResponse: { response: { output: "{}" } } }],
          },
          {
            id: "call-3",
            name: "run_shell_command",
            args: { command: "cat missing.txt" },
            result: [{ functionResponse: { response: { error: "not found" } } }],
          },
        ],
      },
    ],
  };

  function refFor(path: string): SessionRef {
    return {
      agent: "gemini",
      sessionId: "session-abc",
      project: "myproject",
      path,
      lastActivity: Date.now(),
      sizeBytes: 0,
    };
  }

  it("returns real per-tool counts (get_tool_usage_stats path)", () => {
    const file = writeGeminiSession(baseDoc);
    const events = parseSession(refFor(file));

    const toolCounts = new Map<string, number>();
    for (const e of events) {
      if (!e.tool) continue;
      toolCounts.set(e.tool, (toolCounts.get(e.tool) ?? 0) + 1);
    }
    expect(toolCounts.get("gemini:run_shell_command")).toBe(2);
    expect(toolCounts.get("gemini:read_file")).toBe(1);

    const errorCount = events.filter((e) => e.details?.toolError).length;
    expect(errorCount).toBe(1);
  });

  it("returns real token breakdown + USD cost (get_session_cost path)", () => {
    const file = writeGeminiSession(baseDoc);
    const events = parseSession(refFor(file));

    let totalCost = 0;
    let input = 0;
    let cacheRead = 0;
    let cacheCreate = 0;
    let output = 0;
    for (const e of events) {
      const d = e.details;
      if (!d) continue;
      if (d.cost) totalCost += d.cost;
      if (d.usage) {
        input += d.usage.input;
        cacheRead += d.usage.cacheRead;
        cacheCreate += d.usage.cacheCreate;
        output += d.usage.output;
      }
    }

    expect({ input, cacheCreate, cacheRead, output }).toEqual({
      input: 3000,
      cacheCreate: 0,
      cacheRead: 1000,
      output: 200,
    });
    expect(totalCost).toBeGreaterThan(0);
    const expected = (3000 * 1.25 + 1000 * 0.31 + 200 * 10.0) / 1_000_000;
    expect(totalCost).toBeCloseTo(expected, 10);
  });

  it("returns [] for an unreadable / malformed gemini session file", () => {
    dir = mkdtempSync(join(tmpdir(), "agentwatch-gemini-mcp-"));
    const file = join(dir, "session-broken.json");
    writeFileSync(file, "{not valid json");
    expect(parseSession(refFor(file))).toEqual([]);
  });

  it("returns [] when the gemini session file is missing", () => {
    expect(
      parseSession(refFor(join(tmpdir(), "agentwatch-does-not-exist.json"))),
    ).toEqual([]);
  });
});

describe("parseSession — claude-code and codex unaffected", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("still translates claude-code jsonl lines", () => {
    dir = mkdtempSync(join(tmpdir(), "agentwatch-claude-mcp-"));
    const file = join(dir, "session.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    writeFileSync(file, line + "\n");
    const events = parseSession({
      agent: "claude-code",
      sessionId: "s1",
      project: "p",
      path: file,
      lastActivity: Date.now(),
      sizeBytes: 0,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].agent).toBe("claude-code");
  });

  it("still translates codex jsonl lines", () => {
    dir = mkdtempSync(join(tmpdir(), "agentwatch-codex-mcp-"));
    const file = join(dir, "rollout.jsonl");
    const line = JSON.stringify({
      type: "response_item",
      ts: "2026-01-01T00:00:00.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ text: "hi" }],
      },
    });
    writeFileSync(file, line + "\n");
    const events = parseSession({
      agent: "codex",
      sessionId: "s1",
      project: "p",
      path: file,
      lastActivity: Date.now(),
      sizeBytes: 0,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].agent).toBe("codex");
  });
});
