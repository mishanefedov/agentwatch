import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../schema.js";
import { openStore, type EventStore } from "./sqlite.js";

let dir: string;
let store: EventStore;

function makeEvent(over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: over.id ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
    ts: over.ts ?? new Date().toISOString(),
    agent: over.agent ?? "claude-code",
    type: over.type ?? "tool_call",
    path: over.path,
    cmd: over.cmd,
    tool: over.tool,
    summary: over.summary,
    sessionId: over.sessionId,
    promptId: over.promptId,
    riskScore: over.riskScore ?? 1,
    details: over.details,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentwatch-store-"));
  store = openStore({ dbPath: join(dir, "events.db") });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("sqlite store — schema + lifecycle", () => {
  it("initializes schema_version to current", () => {
    expect(store.stats().schemaVersion).toBe(1);
  });

  it("re-opening an existing db is idempotent (CREATE IF NOT EXISTS)", () => {
    const first = store.stats();
    store.close();
    store = openStore({ dbPath: join(dir, "events.db") });
    const second = store.stats();
    expect(second.schemaVersion).toBe(first.schemaVersion);
  });
});

describe("sqlite store — insert + dedup", () => {
  it("stores an event and reads it back", () => {
    const e = makeEvent({
      id: "evt-a",
      summary: "[auraqu] Edit src/foo.ts",
      sessionId: "sess-1",
      details: { fullText: "hello world", cost: 0.05, model: "opus-4-6" },
    });
    store.insert(e);
    const back = store.getEvent("evt-a");
    expect(back).not.toBeNull();
    expect(back?.summary).toBe("[auraqu] Edit src/foo.ts");
    expect(back?.details?.cost).toBeCloseTo(0.05);
    expect(back?.details?.fullText).toBe("hello world");
  });

  it("dedups on event id (INSERT OR IGNORE)", () => {
    const e = makeEvent({ id: "dup", sessionId: "s1" });
    store.insert(e);
    store.insert(e);
    store.insert(e);
    const events = store.listSessionEvents("s1");
    expect(events).toHaveLength(1);
  });

  it("listSessionEvents returns events ordered by ts ascending", () => {
    store.insert(
      makeEvent({ id: "a", ts: "2026-05-01T10:00:00Z", sessionId: "s2" }),
    );
    store.insert(
      makeEvent({ id: "b", ts: "2026-05-01T09:00:00Z", sessionId: "s2" }),
    );
    store.insert(
      makeEvent({ id: "c", ts: "2026-05-01T11:00:00Z", sessionId: "s2" }),
    );
    const ids = store.listSessionEvents("s2").map((e) => e.id);
    expect(ids).toEqual(["b", "a", "c"]);
  });
});

describe("sqlite store — session aggregation trigger", () => {
  it("creates a sessions row when the first event of a session arrives", () => {
    store.insert(
      makeEvent({
        id: "s-evt-1",
        sessionId: "sess-x",
        ts: "2026-05-01T10:00:00Z",
        summary: "[bpi] working",
        details: { cost: 0.02 },
      }),
    );
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: "sess-x",
      project: "bpi",
      eventCount: 1,
    });
    expect(sessions[0]?.costUsd).toBeCloseTo(0.02);
  });

  it("accumulates cost + extends the time range as more events arrive", () => {
    store.insert(
      makeEvent({
        id: "e1",
        sessionId: "s",
        ts: "2026-05-01T10:00:00Z",
        details: { cost: 0.1 },
      }),
    );
    store.insert(
      makeEvent({
        id: "e2",
        sessionId: "s",
        ts: "2026-05-01T11:00:00Z",
        details: { cost: 0.2 },
      }),
    );
    store.insert(
      makeEvent({
        id: "e3",
        sessionId: "s",
        ts: "2026-05-01T09:30:00Z",
        details: { cost: 0.05 },
      }),
    );
    const [s] = store.listSessions();
    expect(s?.eventCount).toBe(3);
    expect(s?.firstTs).toBe("2026-05-01T09:30:00Z");
    expect(s?.lastTs).toBe("2026-05-01T11:00:00Z");
    expect(s?.costUsd).toBeCloseTo(0.35);
  });

  it("filters listSessions by agent + project + since", () => {
    store.insert(
      makeEvent({
        id: "x1",
        sessionId: "sess-a",
        agent: "claude-code",
        ts: "2026-04-01T10:00:00Z",
        summary: "[proj-1] hi",
      }),
    );
    store.insert(
      makeEvent({
        id: "x2",
        sessionId: "sess-b",
        agent: "codex",
        ts: "2026-05-01T10:00:00Z",
        summary: "[proj-2] hi",
      }),
    );
    expect(store.listSessions({ agent: "codex" })).toHaveLength(1);
    expect(store.listSessions({ project: "proj-1" })).toHaveLength(1);
    expect(
      store.listSessions({ since: "2026-04-15T00:00:00Z" }),
    ).toHaveLength(1);
  });
});

describe("sqlite store — enrich", () => {
  it("merges patch into details_json + bumps session cost when cost changes", () => {
    store.insert(
      makeEvent({
        id: "evt-rich",
        sessionId: "rs",
        details: { fullText: "before", cost: 0.0 },
      }),
    );
    store.enrich("evt-rich", {
      toolResult: "stdout output here",
      cost: 0.42,
      durationMs: 1234,
    });
    const back = store.getEvent("evt-rich");
    expect(back?.details?.toolResult).toBe("stdout output here");
    expect(back?.details?.cost).toBeCloseTo(0.42);
    expect(back?.details?.fullText).toBe("before");
    const [s] = store.listSessions();
    expect(s?.costUsd).toBeCloseTo(0.42);
  });

  it("enrich on non-existent event id is a no-op", () => {
    expect(() =>
      store.enrich("does-not-exist", { toolResult: "x" }),
    ).not.toThrow();
  });
});

describe("sqlite store — listProjects", () => {
  it("aggregates per project across agents and sessions", () => {
    store.insertMany([
      makeEvent({
        id: "p1",
        agent: "claude-code",
        sessionId: "s1",
        summary: "[auraqu] one",
        details: { cost: 0.1 },
      }),
      makeEvent({
        id: "p2",
        agent: "codex",
        sessionId: "s2",
        summary: "[auraqu] two",
        details: { cost: 0.2 },
      }),
      makeEvent({
        id: "p3",
        agent: "claude-code",
        sessionId: "s3",
        summary: "[bpi] three",
      }),
    ]);
    const projects = store.listProjects();
    const auraqu = projects.find((p) => p.name === "auraqu");
    expect(auraqu).toBeDefined();
    expect(auraqu?.eventCount).toBe(2);
    expect(auraqu?.byAgent["claude-code"]).toBe(1);
    expect(auraqu?.byAgent.codex).toBe(1);
    expect(auraqu?.cost).toBeCloseTo(0.3);
    expect(auraqu?.sessionIds.sort()).toEqual(["s1", "s2"]);
  });
});

describe("sqlite store — fts5 search", () => {
  it("matches by full text content with snippet markers", () => {
    store.insert(
      makeEvent({
        id: "f1",
        sessionId: "sf",
        details: {
          fullText: "the quick brown fox jumps over the lazy dog",
        },
      }),
    );
    store.insert(
      makeEvent({
        id: "f2",
        sessionId: "sf",
        details: { fullText: "an unrelated message about cats" },
      }),
    );
    const hits = store.searchFts("brown fox");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.eventId).toBe("f1");
    expect(hits[0]?.snippet).toContain("<<");
    expect(hits[0]?.snippet).toContain(">>");
  });

  it("sanitizes FTS-special characters so user input doesn't crash", () => {
    store.insert(
      makeEvent({
        id: "g1",
        details: { fullText: "needle in haystack" },
      }),
    );
    const hits = store.searchFts('"NEEDLE" AND OR -');
    expect(hits.map((h) => h.eventId)).toContain("g1");
  });

  it("empty / whitespace-only query returns []", () => {
    expect(store.searchFts("")).toEqual([]);
    expect(store.searchFts("   ")).toEqual([]);
  });
});

describe("sqlite store — tool_call enrichment", () => {
  it("enrich updates duration + error fields on a tool event", () => {
    store.insert(
      makeEvent({
        id: "tc1",
        type: "shell_exec",
        tool: "Bash",
        cmd: "ls -la",
      }),
    );
    store.enrich("tc1", { durationMs: 99, toolError: true });
    const back = store.getEvent("tc1");
    expect(back?.details?.durationMs).toBe(99);
    expect(back?.details?.toolError).toBe(true);
  });
});

describe("sqlite store — prune", () => {
  it("deletes events older than the cutoff and their session aggregates", () => {
    const oldTs = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const recentTs = new Date(Date.now() - 1 * 86_400_000).toISOString();
    store.insert(
      makeEvent({ id: "old", sessionId: "old-s", ts: oldTs }),
    );
    store.insert(
      makeEvent({ id: "new", sessionId: "new-s", ts: recentTs }),
    );
    const result = store.prune({ olderThanDays: 90 });
    expect(result.deletedEvents).toBe(1);
    expect(store.getEvent("old")).toBeNull();
    expect(store.getEvent("new")).not.toBeNull();
    const sessions = store.listSessions().map((s) => s.sessionId);
    expect(sessions).not.toContain("old-s");
    expect(sessions).toContain("new-s");
  });
});

describe("sqlite store — bench (10k events)", () => {
  it(
    "ingests 10k events in under 2s",
    () => {
      const events: AgentEvent[] = [];
      for (let i = 0; i < 10_000; i++) {
        events.push(
          makeEvent({
            id: `b-${i}`,
            sessionId: `bench-s-${i % 50}`,
            ts: new Date(Date.now() - i * 1000).toISOString(),
            summary: `[bench] turn ${i}`,
            details: {
              fullText: `event number ${i} body content for fts`,
              cost: 0.001,
            },
          }),
        );
      }
      const t0 = performance.now();
      store.insertMany(events);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(2000);
      expect(store.stats().events).toBe(10_000);
    },
    10_000,
  );
});
