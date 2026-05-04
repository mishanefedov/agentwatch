import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedWorkspace } from "../correlate/branch-cache.js";
import type { AgentEvent, EventDetails, EventSink } from "../schema.js";
import { openStore, type EventStore } from "./sqlite.js";
import { wrapSinkWithLinks, wrapSinkWithStore } from "./wire.js";

type FakeResolve = (cwd: string | null | undefined) => ResolvedWorkspace;

let dir: string;
let store: EventStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentwatch-wire-"));
  store = openStore({ dbPath: join(dir, "events.db") });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function recordingSink(): {
  sink: EventSink;
  emitted: AgentEvent[];
  enriched: Array<{ id: string; patch: Partial<EventDetails> }>;
} {
  const emitted: AgentEvent[] = [];
  const enriched: Array<{ id: string; patch: Partial<EventDetails> }> = [];
  return {
    sink: {
      emit: (e) => emitted.push(e),
      enrich: (id, patch) => enriched.push({ id, patch }),
    },
    emitted,
    enriched,
  };
}

function fakeWrite(over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: over.id ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
    ts: over.ts ?? new Date(2026, 0, 1, 12, 0, 0).toISOString(),
    agent: over.agent ?? "claude-code",
    type: over.type ?? "file_write",
    path: over.path ?? "/repo/foo.ts",
    sessionId: over.sessionId ?? "sess-A",
    riskScore: over.riskScore ?? 4,
    details: over.details,
  };
}

const fakeResolve = (cwd: string | null | undefined) => {
  if (!cwd) return { workspaceRoot: null, gitBranch: null };
  return { workspaceRoot: cwd, gitBranch: "main" };
};

/** Compose the production sink chain: linker over store wrapper over a
 *  recording inner. This is the only composition the tests should use —
 *  it exercises the real ordering invariant (codex review flagged a P1
 *  where the previous tests pre-inserted via `store.insert` directly,
 *  masking a bug where `processWrite` ran before `inner.emit` and the
 *  workspace UPDATE hit a row that didn't exist yet). */
function composeProductionSink(
  resolve: FakeResolve = fakeResolve,
): { sink: ReturnType<typeof wrapSinkWithLinks>; emitted: AgentEvent[] } {
  const recorded = recordingSink();
  const persistOnly = wrapSinkWithStore(recorded.sink, store);
  const linked = wrapSinkWithLinks(persistOnly, store, { resolve });
  return { sink: linked, emitted: recorded.emitted };
}

describe("wrapSinkWithLinks — pass-through behaviour", () => {
  it("passes every emit + enrich straight through to the inner chain", () => {
    const inner = recordingSink();
    const linked = wrapSinkWithLinks(inner.sink, store, { resolve: fakeResolve });
    const e = fakeWrite();
    linked.emit(e);
    linked.enrich(e.id, { fullText: "hello" });
    expect(inner.emitted).toHaveLength(1);
    expect(inner.emitted[0]?.id).toBe(e.id);
    expect(inner.enriched).toEqual([{ id: e.id, patch: { fullText: "hello" } }]);
  });

  it("ignores non-write events (no DB write attempt)", () => {
    const { sink } = composeProductionSink();
    const e = fakeWrite({ type: "tool_call", path: undefined });
    sink.emit(e);
    expect(store.countAllLinkCandidates()).toBe(0);
    expect(store.getSessionWorkspace(e.sessionId!).workspaceRoot).toBeNull();
  });

  it("ignores file_write events with no cwd in details", () => {
    const { sink } = composeProductionSink();
    const e = fakeWrite({ details: undefined });
    sink.emit(e);
    expect(store.countAllLinkCandidates()).toBe(0);
    expect(store.getSessionWorkspace(e.sessionId!).workspaceRoot).toBeNull();
  });
});

describe("wrapSinkWithLinks — workspace upsert", () => {
  it("populates workspace_root + git_branch on the FIRST file_write of a session", () => {
    // CRITICAL regression: the previous test pre-inserted via store.insert
    // before calling linked.emit, masking a bug where the linker ran the
    // UPDATE before the events insert trigger had created the sessions
    // row. Now the test uses the real production composition (linker over
    // store wrapper) so a single emit() is the whole flow — and the bug
    // would surface as workspaceRoot staying null.
    const { sink } = composeProductionSink();
    const e = fakeWrite({
      sessionId: "sess-A",
      details: { cwd: "/repo" },
    });
    sink.emit(e);
    expect(store.getSessionWorkspace("sess-A")).toEqual({
      workspaceRoot: "/repo",
      gitBranch: "main",
    });
  });

  it("first-write-wins — a later resolve doesn't overwrite a populated row", () => {
    const recorded = recordingSink();
    const persistOnly = wrapSinkWithStore(recorded.sink, store);
    let nextRoot: string | null = "/repo";
    let nextBranch: string | null = "main";
    const linked = wrapSinkWithLinks(persistOnly, store, {
      resolve: () => ({ workspaceRoot: nextRoot, gitBranch: nextBranch }),
    });
    const e1 = fakeWrite({ id: "e1", details: { cwd: "/repo" } });
    linked.emit(e1);
    nextRoot = "/elsewhere";
    nextBranch = "feature";
    const e2 = fakeWrite({ id: "e2", details: { cwd: "/elsewhere" } });
    linked.emit(e2);
    expect(store.getSessionWorkspace("sess-A")).toEqual({
      workspaceRoot: "/repo",
      gitBranch: "main",
    });
  });
});

describe("wrapSinkWithLinks — candidate-pair recording", () => {
  it("records a candidate pair when two agents touch the same file in-window", () => {
    const { sink } = composeProductionSink();
    const t0 = new Date(2026, 0, 1, 12, 0, 0);
    const t1 = new Date(2026, 0, 1, 12, 5, 0); // 5 min later, in window
    const claude = fakeWrite({
      id: "evt-claude",
      agent: "claude-code",
      sessionId: "sess-claude",
      ts: t0.toISOString(),
      details: { cwd: "/repo" },
    });
    const openclaw = fakeWrite({
      id: "evt-openclaw",
      agent: "openclaw",
      sessionId: "sess-openclaw",
      ts: t1.toISOString(),
      details: { cwd: "/repo" },
    });
    sink.emit(claude);
    sink.emit(openclaw);
    const candidates = store.listSessionLinkCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      aSession: "sess-claude", // canonical sort: sess-claude < sess-openclaw
      bSession: "sess-openclaw",
      aAgent: "claude-code",
      bAgent: "openclaw",
      linkCount: 1,
      samplePath: "/repo/foo.ts",
      workspaceRoot: "/repo",
      gitBranch: "main",
    });
  });

  it("bumps link_count + last_link_ts on a repeat hit", () => {
    const { sink } = composeProductionSink();
    const claude = fakeWrite({
      id: "evt-claude",
      agent: "claude-code",
      sessionId: "sess-claude",
      ts: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
      details: { cwd: "/repo" },
    });
    const openclaw1 = fakeWrite({
      id: "evt-openclaw-1",
      agent: "openclaw",
      sessionId: "sess-openclaw",
      ts: new Date(2026, 0, 1, 12, 5, 0).toISOString(),
      details: { cwd: "/repo" },
    });
    const openclaw2 = fakeWrite({
      id: "evt-openclaw-2",
      agent: "openclaw",
      sessionId: "sess-openclaw",
      ts: new Date(2026, 0, 1, 12, 10, 0).toISOString(),
      details: { cwd: "/repo" },
    });
    sink.emit(claude);
    sink.emit(openclaw1);
    sink.emit(openclaw2);
    const candidates = store.listSessionLinkCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.linkCount).toBe(2);
    expect(candidates[0]?.lastLinkTs).toBe(openclaw2.ts);
    expect(candidates[0]?.firstLinkTs).toBe(openclaw1.ts);
  });

  it("does not record when resolve returns a null branch", () => {
    const { sink } = composeProductionSink((cwd) => ({
      workspaceRoot: cwd ?? null,
      gitBranch: null,
    }));
    const claude = fakeWrite({
      sessionId: "sess-claude",
      agent: "claude-code",
      details: { cwd: "/repo" },
    });
    const openclaw = fakeWrite({
      sessionId: "sess-openclaw",
      agent: "openclaw",
      details: { cwd: "/repo" },
    });
    sink.emit(claude);
    sink.emit(openclaw);
    expect(store.countAllLinkCandidates()).toBe(0);
  });
});

describe("wrapSinkWithStore — regression: layered with linker stays parity", () => {
  // CRITICAL: AUR-276 must not regress wrapSinkWithStore semantics. An
  // event emitted through the layered chain must still land in the events
  // table identically to one going through the store wrapper alone.
  it("an event emitted through link→store lands in events identically", () => {
    const noopInner: EventSink = { emit: () => undefined, enrich: () => undefined };
    const persistOnly = wrapSinkWithStore(noopInner, store);
    const linked = wrapSinkWithLinks(persistOnly, store);
    const e = fakeWrite({
      id: "evt-regression",
      sessionId: "sess-regression",
      details: { cwd: "/repo", fullText: "hi" },
    });
    linked.emit(e);
    const back = store.getEvent(e.id);
    expect(back).not.toBeNull();
    expect(back?.id).toBe(e.id);
    expect(back?.path).toBe(e.path);
    expect(back?.sessionId).toBe(e.sessionId);
  });
});
