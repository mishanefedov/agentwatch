import { describe, expect, it } from "vitest";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { translateClaudeLine } from "./claude-code.js";
import { readNewlineTerminatedLines } from "../util/jsonl-stream.js";

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

describe("claude-code adapter — partial-line streaming (AUR-227)", () => {
  it("recovers a JSONL line that was flushed across two reads", () => {
    // Reproduces the bug: producer writes the first half of a JSON line,
    // we read up to size, then the rest of the line is appended. Under
    // the old readline-based loop the partial line was parsed (and lost
    // on JSON.parse failure) AND the cursor advanced past it, so the
    // second read couldn't find it. With the AUR-227 fix the cursor
    // stays at the start of the unterminated tail until a full line is
    // available.
    const dir = mkdtempSync(join(tmpdir(), "aw-claude-"));
    const session = join(dir, "session.jsonl");
    const firstHalf =
      '{"type":"user","timestamp":"2026-04-25T10:00:00Z","message":{"role":"user","content":"hello world from a chunk';
    writeFileSync(session, firstHalf);

    // First read at the partial flush: nothing terminated → 0 consumed.
    const sz1 = statSync(session).size;
    const first = readNewlineTerminatedLines(session, 0, sz1 - 1);
    expect(first.lines).toHaveLength(0);
    expect(first.consumed).toBe(0);

    // Producer flushes the rest.
    appendFileSync(session, ' that should arrive intact"}}\n');

    const sz2 = statSync(session).size;
    const second = readNewlineTerminatedLines(
      session,
      first.consumed,
      sz2 - 1,
    );
    expect(second.lines).toHaveLength(1);
    const parsed = JSON.parse(second.lines[0]!);
    expect(parsed.message.content).toBe(
      "hello world from a chunk that should arrive intact",
    );
    expect(first.consumed + second.consumed).toBe(sz2);
  });

  it("does not advance the cursor past an unterminated tail", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-claude-"));
    mkdirSync(dir, { recursive: true });
    const session = join(dir, "s.jsonl");
    // One terminated line + one partial line.
    writeFileSync(session, '{"a":1}\n{"b":2,"c":');

    const sz = statSync(session).size;
    const { lines, consumed } = readNewlineTerminatedLines(
      session,
      0,
      sz - 1,
    );
    expect(lines).toEqual(['{"a":1}']);
    // Cursor sits at the start of the partial line (after the first \n),
    // so when the rest arrives we re-read from there.
    expect(consumed).toBe(8);
  });
});
