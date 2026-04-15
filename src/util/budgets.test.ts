import { describe, expect, it } from "vitest";
import { computeBudgetStatus } from "./budgets.js";
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

describe("computeBudgetStatus", () => {
  const now = new Date("2026-04-15T12:00:00Z");

  it("aggregates per-session and per-day cost, flags no breach when under caps", () => {
    const events: AgentEvent[] = [
      evt({ sessionId: "a", details: { cost: 1 }, ts: "2026-04-15T08:00:00Z" }),
      evt({ sessionId: "a", details: { cost: 1 }, ts: "2026-04-15T09:00:00Z" }),
      evt({ sessionId: "b", details: { cost: 0.5 }, ts: "2026-04-15T11:00:00Z" }),
    ];
    const s = computeBudgetStatus(
      events,
      { perSessionUsd: 5, perDayUsd: 10 },
      now,
    );
    expect(s.sessionCost).toBe(2);
    expect(s.dayCost).toBeCloseTo(2.5);
    expect(s.breachedSession).toBeUndefined();
    expect(s.dayBreach).toBe(false);
  });

  it("flags the breaching session when session cost exceeds cap", () => {
    const events: AgentEvent[] = [
      evt({ sessionId: "a", details: { cost: 6 } }),
    ];
    const s = computeBudgetStatus(events, { perSessionUsd: 5 }, now);
    expect(s.breachedSession).toBe("a");
  });

  it("flags day breach when total day cost exceeds cap", () => {
    const events: AgentEvent[] = [
      evt({ details: { cost: 15 }, ts: "2026-04-15T09:00:00Z" }),
    ];
    const s = computeBudgetStatus(events, { perDayUsd: 10 }, now);
    expect(s.dayBreach).toBe(true);
  });

  it("excludes events from previous days from day total", () => {
    const events: AgentEvent[] = [
      evt({ details: { cost: 100 }, ts: "2026-04-14T23:00:00Z" }),
      evt({ details: { cost: 1 }, ts: "2026-04-15T10:00:00Z" }),
    ];
    const s = computeBudgetStatus(events, { perDayUsd: 50 }, now);
    expect(s.dayCost).toBe(1);
    expect(s.dayBreach).toBe(false);
  });
});
