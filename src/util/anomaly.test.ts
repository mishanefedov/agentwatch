import { describe, expect, it } from "vitest";
import {
  detectStuckLoop,
  eventSignature,
  mad,
  median,
  robustZ,
  scoreEvent,
} from "./anomaly.js";
import type { AgentEvent } from "../schema.js";

const evt = (o: Partial<AgentEvent>): AgentEvent => ({
  id: Math.random().toString(36).slice(2),
  ts: "2026-04-15T10:00:00Z",
  agent: "claude-code",
  type: "tool_call",
  riskScore: 0,
  ...o,
});

describe("median + mad", () => {
  it("median handles odd and even lengths", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("mad scales to be ≈ stddev for normal-ish data", () => {
    // Symmetric data around 0 — MAD should be positive and non-zero.
    const m = mad([-2, -1, 0, 1, 2]);
    expect(m).toBeGreaterThan(0);
  });

  it("mad returns 0 for fewer than 2 points", () => {
    expect(mad([])).toBe(0);
    expect(mad([5])).toBe(0);
  });

  it("robustZ catches an outlier in heavy-tailed cost data", () => {
    const history = [0.01, 0.02, 0.015, 0.03, 0.025, 0.02, 0.018];
    expect(robustZ(0.02, history)).toBeLessThan(1);
    expect(robustZ(0.5, history)).toBeGreaterThan(10);
  });
});

describe("eventSignature", () => {
  it("collapses numeric tails to N so same-shape commands collide", () => {
    const a = evt({ cmd: "rm /tmp/abc123", tool: "Bash" });
    const b = evt({ cmd: "rm /tmp/xyz456", tool: "Bash" });
    expect(eventSignature(a)).toBe(eventSignature(b));
  });
});

describe("detectStuckLoop", () => {
  it("flags a run of ≥3 identical signatures", () => {
    const loop = Array.from({ length: 5 }, () =>
      evt({ tool: "Bash", cmd: "ls" }),
    );
    expect(detectStuckLoop(loop)?.count).toBeGreaterThanOrEqual(3);
  });

  it("does not flag distinct events", () => {
    const mixed = [
      evt({ tool: "Bash", cmd: "ls" }),
      evt({ tool: "Read", path: "/a" }),
      evt({ tool: "Edit", path: "/b" }),
      evt({ tool: "Bash", cmd: "pwd" }),
    ];
    expect(detectStuckLoop(mixed)).toBeNull();
  });
});

describe("scoreEvent", () => {
  it("flags a cost outlier above |z| > 3.5", () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      evt({ details: { cost: 0.01 + (i % 3) * 0.002 } }),
    );
    const outlier = evt({ details: { cost: 1.5 } });
    const flags = scoreEvent(outlier, history);
    expect(flags.some((f) => f.kind === "cost")).toBe(true);
  });

  it("does not flag normal events", () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      evt({ details: { cost: 0.01 + (i % 5) * 0.001 } }),
    );
    const normal = evt({ details: { cost: 0.012 } });
    expect(scoreEvent(normal, history)).toEqual([]);
  });

  it("requires minSamples of history before scoring", () => {
    const history = [evt({ details: { cost: 0.01 } })];
    const maybeOutlier = evt({ details: { cost: 10 } });
    expect(scoreEvent(maybeOutlier, history)).toEqual([]);
  });
});
