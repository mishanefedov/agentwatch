import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attributeTokens,
  attributeTurns,
  approxTokens,
  countTokens,
  _resetMemoryFileCache,
} from "./token-attribution.js";
import type { AgentEvent } from "../schema.js";

const evt = (o: Partial<AgentEvent>): AgentEvent => ({
  id: Math.random().toString(36).slice(2),
  ts: o.ts ?? "2026-04-15T10:00:00Z",
  agent: "claude-code",
  type: "response",
  riskScore: 0,
  sessionId: "s1",
  ...o,
});

beforeEach(() => _resetMemoryFileCache());

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("returns a positive integer for non-empty text", () => {
    const n = countTokens("The quick brown fox jumps over the lazy dog.");
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it("scales roughly linearly with repeated text", () => {
    const small = countTokens("hello");
    const big = countTokens("hello ".repeat(100));
    expect(big).toBeGreaterThan(small * 50);
  });
});

describe("approxTokens (legacy char-based)", () => {
  it("returns chars/4 rounded up", () => {
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
    expect(approxTokens("")).toBe(0);
  });
});

describe("attributeTurns", () => {
  it("produces one breakdown per assistant turn with preceding prompt attributed", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tok-"));
    const events: AgentEvent[] = [
      evt({
        type: "prompt",
        ts: "2026-04-15T10:00:00Z",
        details: { fullText: "write a sorting algorithm" },
      }),
      evt({
        type: "response",
        ts: "2026-04-15T10:00:05Z",
        details: {
          usage: { input: 1000, cacheRead: 500, cacheCreate: 0, output: 200 },
          cost: 0.01,
          thinking: "Thinking about quick-sort vs merge-sort.",
        },
      }),
    ];
    const turns = attributeTurns(events, "s1", tmp);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.user).toBeGreaterThan(0);
    expect(turns[0]!.thinking).toBeGreaterThan(0);
    expect(turns[0]!.input).toBe(1000);
    expect(turns[0]!.cost).toBe(0.01);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("folds tool I/O into the next assistant turn", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tok-"));
    const events: AgentEvent[] = [
      evt({
        type: "prompt",
        ts: "2026-04-15T10:00:00Z",
        details: { fullText: "list files" },
      }),
      evt({
        type: "shell_exec",
        ts: "2026-04-15T10:00:01Z",
        details: { toolResult: "file1.ts\nfile2.ts\nfile3.ts" },
      }),
      evt({
        type: "response",
        ts: "2026-04-15T10:00:02Z",
        details: {
          usage: { input: 100, cacheRead: 0, cacheCreate: 0, output: 50 },
        },
      }),
    ];
    const turns = attributeTurns(events, "s1", tmp);
    expect(turns[0]!.toolIO).toBeGreaterThan(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("includes CLAUDE.md tokens when present in cwd", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tok-"));
    fs.writeFileSync(
      path.join(tmp, "CLAUDE.md"),
      "# Project memory\n\nThis is project-specific Claude context.",
    );
    const events: AgentEvent[] = [
      evt({
        type: "response",
        details: {
          usage: { input: 100, cacheRead: 0, cacheCreate: 0, output: 0 },
        },
      }),
    ];
    const turns = attributeTurns(events, "s1", tmp);
    expect(turns[0]!.memoryFile).toBeGreaterThan(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("attributeTokens (aggregate)", () => {
  it("sums per-turn categories and reports single claudeMd value", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tok-"));
    const events: AgentEvent[] = [
      evt({
        type: "response",
        ts: "2026-04-15T10:00:00Z",
        details: {
          usage: { input: 100, cacheCreate: 0, cacheRead: 0, output: 50 },
          cost: 0.005,
        },
      }),
      evt({
        type: "response",
        ts: "2026-04-15T10:01:00Z",
        details: {
          usage: { input: 200, cacheCreate: 0, cacheRead: 50, output: 30 },
          cost: 0.003,
        },
      }),
    ];
    const agg = attributeTokens(events, "s1", tmp);
    expect(agg.input).toBe(300);
    expect(agg.output).toBe(80);
    expect(agg.cost).toBeCloseTo(0.008);
    expect(agg.turns).toBe(2);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
