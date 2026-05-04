import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, EventDetails, EventSink } from "../schema.js";
import { openStore, type EventStore } from "./sqlite.js";
import { wrapSinkWithLinks, wrapSinkWithStore } from "./wire.js";

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

describe("wrapSinkWithLinks — pass-through behaviour", () => {
  it("passes every emit + enrich straight through to the inner sink", () => {
    const inner = recordingSink();
    const linked = wrapSinkWithLinks(inner.sink, store, { resolve: fakeResolve });
    const e = fakeWrite();
    // Insert the event via the store first so the sessions row exists for
    // upsertSessionWorkspace to update.
    store.insert(e);
    linked.emit(e);
    linked.enrich(e.id, { fullText: "hello" });
    expect(inner.emitted).toHaveLength(1);
    expect(inner.emitted[0]?.id).toBe(e.id);
    expect(inner.enriched).toEqual([{ id: e.id, patch: { fullText: "hello" } }]);
  });

  it("ignores non-write events (no DB write attempt)", () => {
    const inner = recordingSink();
    const linked = wrapSinkWithLinks(inner.sink, store, { resolve: fakeResolve });
    const e = fakeWrite({ type: "tool_call", path: undefined });
    store.insert(e);
    linked.emit(e);
    expect(store.countAllLinkCandidates()).toBe(0);
    expect(store.getSessionWorkspace(e.sessionId!).workspaceRoot).toBeNull();
  });

  it("ignores file_write events with no cwd in details", () => {
    const inner = recordingSink();
    const linked = wrapSinkWithLinks(inner.sink, store, { resolve: fakeResolve });
    const e = fakeWrite({ details: undefined });
    store.insert(e);
    linked.emit(e);
    expect(store.countAllLinkCandidates()).toBe(0);
    expect(store.getSessionWorkspace(e.sessionId!).workspaceRoot).toBeNull();
  });
});

describe("wrapSinkWithLinks — workspace upsert", () => {
  it("populates workspace_root + git_branch on the session row from cwd", () => {
    const inner = recordingSink();
    const linked = wrapSinkWithLinks(inner.sink, store, { resolve: fakeResolve });
    const e = fakeWrite({
      sessionId: "sess-A",
      details: { cwd: "/repo" },
    });
    store.insert(e);
    linked.emit(e);
    const ws = store.getSessionWorkspace("sess-A");
    expect(ws).toEqual({ workspaceRoot: "/repo", gitBranch: "main" });
  });

  it("first-write-wins — a later resolve doesn't overwrite a populated row", () => {
    const inner = recordingSink();
    let nextRoot = "/repo";
    let nextBranch: string | null = "main";
    const linked = wrapSinkWithLinks(inner.sink, store, {
      resolve: () => ({ workspaceRoot: nextRoot, gitBranch: nextBranch }),
    });
    const e1 = fakeWrite({ id: "e1", details: { cwd: "/repo" } });
    store.insert(e1);
    linked.emit(e1);
    nextRoot = "/elsewhere";
    nextBranch = "feature";
    const e2 = fakeWrite({ id: "e2", details: { cwd: "/elsewhere" } });
    store.insert(e2); // same session, so the same sessions row
    linked.emit(e2);
    expect(store.getSessionWorkspace("sess-A")).toEqual({
      workspaceRoot: "/repo",
      gitBranch: "main",
    });
  });
});

describe("wrapSinkWithLinks — candidate-pair recording", () => {
  it("records a candidate pair when two agents touch the same file in-window", () => {
    const inner = recordingSink();
    const linked = wrapSinkWithLinks(inner.sink, store, { resolve: fakeResolve });
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
    store.insert(claude);
    store.insert(openclaw);
    linked.emit(claude);
    linked.emit(openclaw);
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
    const inner = recordingSink();
    const linked = wrapSinkWithLinks(inner.sink, store, { resolve: fakeResolve });
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
    store.insert(claude);
    store.insert(openclaw1);
    store.insert(openclaw2);
    linked.emit(claude);
    linked.emit(openclaw1);
    linked.emit(openclaw2);
    const candidates = store.listSessionLinkCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.linkCount).toBe(2);
    expect(candidates[0]?.lastLinkTs).toBe(openclaw2.ts);
    expect(candidates[0]?.firstLinkTs).toBe(openclaw1.ts);
  });

  it("does not record when resolve returns a null branch", () => {
    const inner = recordingSink();
    const linked = wrapSinkWithLinks(inner.sink, store, {
      resolve: (cwd) => ({ workspaceRoot: cwd ?? null, gitBranch: null }),
    });
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
    store.insert(claude);
    store.insert(openclaw);
    linked.emit(claude);
    linked.emit(openclaw);
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
