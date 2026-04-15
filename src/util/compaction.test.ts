import { describe, expect, it } from "vitest";
import {
  buildCompactionSeries,
  renderCompactionBar,
  contextWindow,
} from "./compaction.js";
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

describe("contextWindow", () => {
  it("defaults to 200k", () => {
    delete process.env.AGENTWATCH_CONTEXT_WINDOW;
    expect(contextWindow()).toBe(200_000);
  });

  it("respects the env override", () => {
    process.env.AGENTWATCH_CONTEXT_WINDOW = "1000000";
    expect(contextWindow()).toBe(1_000_000);
    delete process.env.AGENTWATCH_CONTEXT_WINDOW;
  });
});

describe("buildCompactionSeries", () => {
  it("produces one turn per assistant turn with usage data", () => {
    const events: AgentEvent[] = [
      evt({
        ts: "2026-04-15T10:00:00Z",
        details: {
          usage: { input: 1000, cacheRead: 50_000, cacheCreate: 0, output: 100 },
        },
      }),
      evt({
        ts: "2026-04-15T10:01:00Z",
        details: {
          usage: { input: 2000, cacheRead: 100_000, cacheCreate: 0, output: 200 },
        },
      }),
    ];
    const series = buildCompactionSeries(events, "s1", 200_000);
    expect(series.points).toHaveLength(2);
    expect(series.points[0]!.kind).toBe("turn");
    expect(series.points[0]!.fillBefore).toBeCloseTo(51_000 / 200_000);
    expect(series.points[1]!.fillBefore).toBeCloseTo(102_000 / 200_000);
    expect(series.compactionCount).toBe(0);
  });

  it("records compaction events with before / after fills", () => {
    const events: AgentEvent[] = [
      evt({
        ts: "2026-04-15T10:00:00Z",
        details: {
          usage: { input: 180_000, cacheRead: 0, cacheCreate: 0, output: 200 },
        },
      }),
      evt({ ts: "2026-04-15T10:00:30Z", type: "compaction" }),
      evt({
        ts: "2026-04-15T10:01:00Z",
        details: {
          usage: { input: 5_000, cacheRead: 0, cacheCreate: 0, output: 100 },
        },
      }),
    ];
    const series = buildCompactionSeries(events, "s1", 200_000);
    expect(series.compactionCount).toBe(1);
    const compact = series.points.find((p) => p.kind === "compaction")!;
    expect(compact.fillBefore).toBeCloseTo(0.9);
    expect(compact.fillAfter).toBe(0);
    expect(series.points[series.points.length - 1]!.fillBefore).toBeCloseTo(0.025);
  });

  it("ignores events from other sessions", () => {
    const events: AgentEvent[] = [
      evt({
        sessionId: "other",
        details: {
          usage: { input: 100_000, cacheRead: 0, cacheCreate: 0, output: 0 },
        },
      }),
    ];
    expect(buildCompactionSeries(events, "s1").points).toHaveLength(0);
  });
});

describe("renderCompactionBar", () => {
  it("produces block characters whose density tracks fill %", () => {
    const events: AgentEvent[] = [
      evt({
        ts: "2026-04-15T10:00:00Z",
        details: {
          usage: { input: 20_000, cacheRead: 0, cacheCreate: 0, output: 0 },
        },
      }),
      evt({
        ts: "2026-04-15T10:01:00Z",
        details: {
          usage: { input: 180_000, cacheRead: 0, cacheCreate: 0, output: 0 },
        },
      }),
    ];
    const series = buildCompactionSeries(events, "s1", 200_000);
    const bar = renderCompactionBar(series, 80);
    expect(bar.length).toBe(2);
    // The second turn is much fuller than the first, so its char ord
    // must be strictly higher in the block sequence.
    expect(bar.charCodeAt(1)).toBeGreaterThan(bar.charCodeAt(0));
  });

  it("shows ⋈ for a compaction marker", () => {
    const events: AgentEvent[] = [
      evt({
        details: {
          usage: { input: 180_000, cacheRead: 0, cacheCreate: 0, output: 0 },
        },
      }),
      evt({ ts: "2026-04-15T10:01:00Z", type: "compaction" }),
    ];
    const series = buildCompactionSeries(events, "s1");
    expect(renderCompactionBar(series, 80)).toContain("⋈");
  });
});
