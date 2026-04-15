import { describe, expect, it } from "vitest";
import { attributeTokens, approxTokens } from "./token-attribution.js";
import type { AgentEvent } from "../schema.js";

const evt = (o: Partial<AgentEvent>): AgentEvent => ({
  id: "x",
  ts: "2026-04-15T10:00:00Z",
  agent: "claude-code",
  type: "response",
  riskScore: 0,
  sessionId: "s1",
  ...o,
});

describe("approxTokens", () => {
  it("returns chars/4 rounded up", () => {
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
    expect(approxTokens("")).toBe(0);
  });
});

describe("attributeTokens", () => {
  it("sums precise categories from usage and counts turns", () => {
    const events: AgentEvent[] = [
      evt({
        details: {
          usage: { input: 100, cacheCreate: 200, cacheRead: 300, output: 50 },
          cost: 0.01,
        },
      }),
      evt({
        details: {
          usage: { input: 10, cacheCreate: 0, cacheRead: 500, output: 20 },
          cost: 0.005,
        },
      }),
    ];
    const b = attributeTokens(events, "s1");
    expect(b.input).toBe(110);
    expect(b.cacheCreate).toBe(200);
    expect(b.cacheRead).toBe(800);
    expect(b.output).toBe(70);
    expect(b.cost).toBeCloseTo(0.015);
    expect(b.turns).toBe(2);
  });

  it("approximates thinking / toolIO / user categories from content length", () => {
    const events: AgentEvent[] = [
      evt({
        type: "prompt",
        details: { fullText: "abcd".repeat(10) }, // 40 chars → 10 tokens
      }),
      evt({
        type: "response",
        details: { thinking: "x".repeat(80) }, // 20 tokens
      }),
      evt({
        type: "tool_call",
        details: { toolResult: "y".repeat(40) }, // 10 tokens
      }),
    ];
    const b = attributeTokens(events, "s1");
    expect(b.user).toBe(10);
    expect(b.thinking).toBe(20);
    expect(b.toolIO).toBe(10);
  });

  it("ignores events belonging to a different session", () => {
    const events: AgentEvent[] = [
      evt({
        sessionId: "other",
        details: { usage: { input: 999, cacheCreate: 0, cacheRead: 0, output: 0 } },
      }),
      evt({
        sessionId: "s1",
        details: { usage: { input: 1, cacheCreate: 0, cacheRead: 0, output: 0 } },
      }),
    ];
    expect(attributeTokens(events, "s1").input).toBe(1);
  });
});
