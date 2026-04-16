import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../schema.js";
import {
  MAX_EVENTS,
  findInsertIdx,
  initialState,
  matchesQuery,
  reducer,
  type Action,
  type State,
} from "./state.js";

/**
 * Spec-driven reducer suite. Each block maps to a contract from
 * docs/features/<feature>.md. When a feature's stated behavior changes,
 * the corresponding test block MUST change with it — if you change the
 * behavior and not the test, CI catches it; if you change the test and
 * not the behavior, code review should catch it.
 */

function makeEvent(partial: Partial<AgentEvent> & { ts: string }): AgentEvent {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    agent: "claude-code",
    type: "tool_call",
    riskScore: 0,
    summary: "",
    ...partial,
  };
}

function apply(state: State, ...actions: Action[]): State {
  return actions.reduce(reducer, state);
}

describe("findInsertIdx", () => {
  it("returns 0 for the newest ts into an empty buffer", () => {
    expect(findInsertIdx([], "2026-04-16T00:00:00Z")).toBe(0);
  });

  it("places a newer ts at the head (events are newest-first)", () => {
    const events = [
      makeEvent({ ts: "2026-04-16T00:00:05Z" }),
      makeEvent({ ts: "2026-04-16T00:00:00Z" }),
    ];
    expect(findInsertIdx(events, "2026-04-16T00:00:10Z")).toBe(0);
  });

  it("places an older ts at the tail", () => {
    const events = [
      makeEvent({ ts: "2026-04-16T00:00:05Z" }),
      makeEvent({ ts: "2026-04-16T00:00:01Z" }),
    ];
    expect(findInsertIdx(events, "2026-04-16T00:00:00Z")).toBe(2);
  });

  it("places a mid ts in between", () => {
    const events = [
      makeEvent({ ts: "2026-04-16T00:00:10Z" }),
      makeEvent({ ts: "2026-04-16T00:00:00Z" }),
    ];
    expect(findInsertIdx(events, "2026-04-16T00:00:05Z")).toBe(1);
  });
});

describe("matchesQuery", () => {
  const e = makeEvent({
    ts: "2026-04-16T00:00:00Z",
    summary: "ran rm -rf /tmp",
    path: "/etc/passwd",
    cmd: "rm -rf",
    tool: "Bash",
    agent: "claude-code",
    details: { fullText: "destructive command", thinking: "step one" },
  });

  it.each([
    ["summary substring", "rm -rf"],
    ["path substring", "passwd"],
    ["cmd substring", "RM"],
    ["tool", "bash"],
    ["agent", "claude"],
    ["details.fullText", "destructive"],
    ["details.thinking", "step"],
  ])("matches %s", (_label, q) => {
    expect(matchesQuery(e, q)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesQuery(e, "PASSWD")).toBe(true);
  });

  it("returns false on a miss", () => {
    expect(matchesQuery(e, "completely unrelated")).toBe(false);
  });
});

describe("reducer — event ingestion", () => {
  it("inserts a single event at the correct (newest-first) position", () => {
    const s1 = reducer(initialState(), {
      type: "event",
      event: makeEvent({ id: "a", ts: "2026-04-16T00:00:00Z" }),
    });
    const s2 = reducer(s1, {
      type: "event",
      event: makeEvent({ id: "b", ts: "2026-04-16T00:00:10Z" }),
    });
    expect(s2.events.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("drops incoming events while paused", () => {
    const paused = { ...initialState(), paused: true };
    const after = reducer(paused, {
      type: "event",
      event: makeEvent({ id: "x", ts: "2026-04-16T00:00:00Z" }),
    });
    expect(after.events).toEqual([]);
    expect(after).toBe(paused);
  });

  it("caps buffer at MAX_EVENTS", () => {
    let s = initialState();
    for (let i = 0; i < MAX_EVENTS + 10; i++) {
      s = reducer(s, {
        type: "event",
        event: makeEvent({
          id: `e${i}`,
          ts: new Date(2026, 3, 16, 0, 0, i).toISOString(),
        }),
      });
    }
    expect(s.events.length).toBe(MAX_EVENTS);
  });

  it("shifts selectedIdx forward when a newer event is inserted above it", () => {
    let s = initialState();
    s = reducer(s, {
      type: "event",
      event: makeEvent({ id: "a", ts: "2026-04-16T00:00:00Z" }),
    });
    s = { ...s, selectedIdx: 0 };
    s = reducer(s, {
      type: "event",
      event: makeEvent({ id: "b", ts: "2026-04-16T00:00:10Z" }),
    });
    // b inserted at index 0, a moved to index 1, selection follows a
    expect(s.events.map((e) => e.id)).toEqual(["b", "a"]);
    expect(s.selectedIdx).toBe(1);
  });
});

describe("reducer — events-batch (backfill)", () => {
  it("merges a batch into existing sorted buffer, newest-first", () => {
    let s = initialState();
    s = reducer(s, {
      type: "event",
      event: makeEvent({ id: "z", ts: "2026-04-16T00:00:05Z" }),
    });
    s = reducer(s, {
      type: "events-batch",
      events: [
        makeEvent({ id: "a", ts: "2026-04-16T00:00:00Z" }),
        makeEvent({ id: "c", ts: "2026-04-16T00:00:10Z" }),
        makeEvent({ id: "b", ts: "2026-04-16T00:00:03Z" }),
      ],
    });
    expect(s.events.map((e) => e.id)).toEqual(["c", "z", "b", "a"]);
  });

  it("ignores empty batches", () => {
    const s0 = initialState();
    const s1 = reducer(s0, { type: "events-batch", events: [] });
    expect(s1).toBe(s0);
  });

  it("does not merge while paused", () => {
    const s0 = { ...initialState(), paused: true };
    const s1 = reducer(s0, {
      type: "events-batch",
      events: [makeEvent({ id: "a", ts: "2026-04-16T00:00:00Z" })],
    });
    expect(s1).toBe(s0);
  });

  it("caps merged buffer at MAX_EVENTS", () => {
    const batch: AgentEvent[] = [];
    for (let i = 0; i < MAX_EVENTS + 50; i++) {
      batch.push(
        makeEvent({
          id: `b${i}`,
          ts: new Date(2026, 3, 16, 0, 0, i).toISOString(),
        }),
      );
    }
    const s = reducer(initialState(), { type: "events-batch", events: batch });
    expect(s.events.length).toBe(MAX_EVENTS);
  });
});

describe("reducer — enrich", () => {
  it("patches details on the matching event only", () => {
    let s = initialState();
    s = reducer(s, {
      type: "events-batch",
      events: [
        makeEvent({ id: "a", ts: "2026-04-16T00:00:00Z" }),
        makeEvent({
          id: "b",
          ts: "2026-04-16T00:00:10Z",
          details: { fullText: "original" },
        }),
      ],
    });
    const s2 = reducer(s, {
      type: "enrich",
      eventId: "b",
      patch: { durationMs: 123 },
    });
    const b = s2.events.find((e) => e.id === "b")!;
    expect(b.details?.durationMs).toBe(123);
    expect(b.details?.fullText).toBe("original");
    const a = s2.events.find((e) => e.id === "a")!;
    expect(a.details).toBeUndefined();
  });

  it("is a no-op when the eventId is unknown", () => {
    const s0 = initialState();
    const s1 = reducer(s0, {
      type: "enrich",
      eventId: "nope",
      patch: { durationMs: 1 },
    });
    expect(s1).toBe(s0);
  });
});

describe("reducer — navigation (move + selectedIdx)", () => {
  it("clamps move to [0, max-1]", () => {
    const s = { ...initialState(), selectedIdx: null };
    const s1 = reducer(s, { type: "move", delta: 1, max: 10 });
    expect(s1.selectedIdx).toBe(0);
    const s2 = reducer(s1, { type: "move", delta: 999, max: 10 });
    expect(s2.selectedIdx).toBe(9);
    const s3 = reducer(s2, { type: "move", delta: -999, max: 10 });
    expect(s3.selectedIdx).toBe(0);
  });

  it("is a no-op when max is 0 (empty timeline)", () => {
    const s0 = initialState();
    const s1 = reducer(s0, { type: "move", delta: 1, max: 0 });
    expect(s1).toBe(s0);
  });

  it("open-detail requires a selection", () => {
    const s0 = initialState();
    const s1 = reducer(s0, { type: "open-detail" });
    expect(s1).toBe(s0);

    const s2 = reducer({ ...s0, selectedIdx: 0 }, { type: "open-detail" });
    expect(s2.detailOpen).toBe(true);
    expect(s2.detailScroll).toBe(0);
  });
});

describe("reducer — cycle-filter", () => {
  it("cycles through the agent list and wraps to null", () => {
    const agents: Array<"claude-code" | "codex"> = ["claude-code", "codex"];
    let s = initialState();
    expect(s.filterAgent).toBeNull();
    s = reducer(s, { type: "cycle-filter", agents });
    expect(s.filterAgent).toBe("claude-code");
    s = reducer(s, { type: "cycle-filter", agents });
    expect(s.filterAgent).toBe("codex");
    s = reducer(s, { type: "cycle-filter", agents });
    expect(s.filterAgent).toBeNull();
  });

  it("clears selection when the filter changes", () => {
    const s = { ...initialState(), selectedIdx: 3 };
    const after = reducer(s, { type: "cycle-filter", agents: ["claude-code"] });
    expect(after.selectedIdx).toBeNull();
  });
});

describe("reducer — home resets everything", () => {
  it("wipes every active modal, filter, and scope in one action", () => {
    const s: State = {
      ...initialState(),
      showHelp: true,
      showPermissions: true,
      detailOpen: true,
      projectsOpen: true,
      sessionsForProject: "foo",
      projectFilter: "p",
      sessionFilter: "s",
      subAgentScope: "sub",
      filterAgent: "claude-code",
      searchQuery: "q",
      searchOpen: true,
      selectedIdx: 3,
      detailScroll: 5,
      permissionsScroll: 5,
      sessionsScroll: 5,
    };
    const after = reducer(s, { type: "home" });
    expect(after.showHelp).toBe(false);
    expect(after.showPermissions).toBe(false);
    expect(after.detailOpen).toBe(false);
    expect(after.projectsOpen).toBe(false);
    expect(after.sessionsForProject).toBeNull();
    expect(after.projectFilter).toBeNull();
    expect(after.sessionFilter).toBeNull();
    expect(after.subAgentScope).toBeNull();
    expect(after.filterAgent).toBeNull();
    expect(after.searchQuery).toBe("");
    expect(after.searchOpen).toBe(false);
    expect(after.selectedIdx).toBeNull();
    expect(after.detailScroll).toBe(0);
    expect(after.permissionsScroll).toBe(0);
    expect(after.sessionsScroll).toBe(0);
  });
});

describe("reducer — back (esc escape hatch)", () => {
  it("peels modals in the documented precedence order", () => {
    const base = initialState();
    // help closes first
    expect(
      reducer({ ...base, showHelp: true, detailOpen: true }, { type: "back" })
        .showHelp,
    ).toBe(false);
    // detail before permissions
    const s1 = reducer(
      { ...base, detailOpen: true, showPermissions: true },
      { type: "back" },
    );
    expect(s1.detailOpen).toBe(false);
    expect(s1.showPermissions).toBe(true);
    // sessions closes and re-opens projects grid
    const s2 = reducer(
      { ...base, sessionsForProject: "p" },
      { type: "back" },
    );
    expect(s2.sessionsForProject).toBeNull();
    expect(s2.projectsOpen).toBe(true);
  });

  it("peels scope then filter layers in order", () => {
    const base = initialState();
    const s1 = reducer(
      { ...base, subAgentScope: "sub", sessionFilter: "sess" },
      { type: "back" },
    );
    expect(s1.subAgentScope).toBeNull();
    expect(s1.sessionFilter).toBe("sess"); // not yet popped

    const s2 = reducer(s1, { type: "back" });
    expect(s2.sessionFilter).toBeNull();
  });

  it("finally clears selectedIdx and is a no-op on empty state", () => {
    const base = initialState();
    const s1 = reducer({ ...base, selectedIdx: 5 }, { type: "back" });
    expect(s1.selectedIdx).toBeNull();
    const s2 = reducer(s1, { type: "back" });
    expect(s2).toBe(s1);
  });
});

describe("reducer — clear-filters", () => {
  it("wipes all filters/scopes but keeps modals/overlays open", () => {
    const s: State = {
      ...initialState(),
      projectFilter: "p",
      sessionFilter: "s",
      subAgentScope: "sub",
      filterAgent: "claude-code",
      searchQuery: "q",
      detailOpen: true,
      showHelp: true,
    };
    const after = reducer(s, { type: "clear-filters" });
    expect(after.projectFilter).toBeNull();
    expect(after.sessionFilter).toBeNull();
    expect(after.subAgentScope).toBeNull();
    expect(after.filterAgent).toBeNull();
    expect(after.searchQuery).toBe("");
    expect(after.detailOpen).toBe(true);
    expect(after.showHelp).toBe(true);
  });
});

describe("reducer — search overlay (unified search)", () => {
  it("open resets query/hits and enters typing mode", () => {
    const s = reducer(initialState(), {
      type: "search-view-open",
      mode: "semantic",
    });
    expect(s.searchViewOpen).toBe(true);
    expect(s.searchMode).toBe("semantic");
    expect(s.searchTyping).toBe(true);
    expect(s.searchQ).toBe("");
    expect(s.searchHits).toEqual([]);
  });

  it("mode switch resets hits and re-enters typing", () => {
    let s = reducer(initialState(), { type: "search-view-open" });
    s = reducer(s, { type: "search-view-type", char: "f" });
    s = reducer(s, { type: "search-view-type", char: "o" });
    s = reducer(s, {
      type: "search-view-submit",
      hits: [{ kind: "live", eventId: "e1", summary: "foo" } as never],
    });
    expect(s.searchHits.length).toBe(1);
    expect(s.searchTyping).toBe(false);

    const s2 = reducer(s, { type: "search-view-mode", mode: "cross" });
    expect(s2.searchMode).toBe("cross");
    expect(s2.searchHits).toEqual([]);
    expect(s2.searchTyping).toBe(true);
  });

  it("type/backspace edits the query buffer", () => {
    let s = reducer(initialState(), { type: "search-view-open" });
    s = apply(
      s,
      { type: "search-view-type", char: "a" },
      { type: "search-view-type", char: "b" },
      { type: "search-view-type", char: "c" },
      { type: "search-view-backspace" },
    );
    expect(s.searchQ).toBe("ab");
  });

  it("move is clamped to hits length", () => {
    let s = reducer(initialState(), { type: "search-view-open" });
    s = reducer(s, {
      type: "search-view-submit",
      hits: [
        { kind: "live", eventId: "1" } as never,
        { kind: "live", eventId: "2" } as never,
        { kind: "live", eventId: "3" } as never,
      ],
    });
    s = reducer(s, { type: "search-view-move", delta: 10 });
    expect(s.searchSelectedIdx).toBe(2);
    s = reducer(s, { type: "search-view-move", delta: -10 });
    expect(s.searchSelectedIdx).toBe(0);
  });

  it("close wipes overlay state", () => {
    let s = reducer(initialState(), { type: "search-view-open" });
    s = reducer(s, { type: "search-view-type", char: "x" });
    s = reducer(s, { type: "search-view-close" });
    expect(s.searchViewOpen).toBe(false);
    expect(s.searchQ).toBe("");
    expect(s.searchHits).toEqual([]);
    expect(s.searchTyping).toBe(false);
  });
});

describe("reducer — sub-agent + sessions scoping", () => {
  it("scope-subagent clears selection and closes detail", () => {
    const s0: State = {
      ...initialState(),
      selectedIdx: 5,
      detailOpen: true,
    };
    const s1 = reducer(s0, { type: "scope-subagent", subAgentId: "sub-a" });
    expect(s1.subAgentScope).toBe("sub-a");
    expect(s1.selectedIdx).toBeNull();
    expect(s1.detailOpen).toBe(false);
  });

  it("sessions-open-selected sets sessionFilter and closes the picker", () => {
    const s0: State = {
      ...initialState(),
      sessionsForProject: "p",
      selectedIdx: 2,
    };
    const s1 = reducer(s0, {
      type: "sessions-open-selected",
      sessionId: "sess-123",
    });
    expect(s1.sessionFilter).toBe("sess-123");
    expect(s1.sessionsForProject).toBeNull();
    expect(s1.selectedIdx).toBeNull();
  });

  it("projects-select opens the sessions picker for that project", () => {
    const s1 = reducer(initialState(), {
      type: "projects-select",
      name: "agentwatch",
    });
    expect(s1.sessionsForProject).toBe("agentwatch");
    expect(s1.projectsOpen).toBe(false);
    expect(s1.sessionsSelectedIdx).toBe(0);
  });
});

describe("reducer — anomaly-mark-notified", () => {
  it("merges ids into the Set without mutating the previous state", () => {
    const s0 = initialState();
    const s1 = reducer(s0, {
      type: "anomaly-mark-notified",
      ids: ["a", "b"],
    });
    expect([...s1.anomalyNotified].sort()).toEqual(["a", "b"]);
    expect(s0.anomalyNotified.size).toBe(0); // previous state untouched

    const s2 = reducer(s1, {
      type: "anomaly-mark-notified",
      ids: ["b", "c"],
    });
    expect([...s2.anomalyNotified].sort()).toEqual(["a", "b", "c"]);
    expect(s1.anomalyNotified.has("c")).toBe(false);
  });
});

describe("reducer — toggle-* overlays reset their selected index", () => {
  it.each([
    ["toggle-compaction", "showCompaction", "compactionSelectedIdx"],
    ["toggle-call-graph", "showCallGraph", "callGraphSelectedIdx"],
    ["toggle-scheduled", "showScheduled", "scheduledSelectedIdx"],
  ] as const)(
    "%s flips visibility and resets the idx",
    (type, visibleKey, idxKey) => {
      const s0: State = {
        ...initialState(),
        [visibleKey]: true,
        [idxKey]: 7,
      };
      const s1 = reducer(s0, { type } as Action);
      expect((s1 as unknown as Record<string, unknown>)[visibleKey]).toBe(false);
      expect((s1 as unknown as Record<string, unknown>)[idxKey]).toBe(0);
    },
  );
});

describe("reducer — compound action traces (documented flows)", () => {
  it("home → scope → search → back → back restores defaults", () => {
    let s = initialState();
    s = reducer(s, { type: "scope-subagent", subAgentId: "sub" });
    s = reducer(s, { type: "search-view-open", mode: "live" });
    expect(s.subAgentScope).toBe("sub");
    expect(s.searchViewOpen).toBe(true);

    s = reducer(s, { type: "search-view-close" });
    expect(s.searchViewOpen).toBe(false);
    expect(s.subAgentScope).toBe("sub"); // scope survives overlay close

    s = reducer(s, { type: "back" }); // peels sub-agent scope
    expect(s.subAgentScope).toBeNull();
  });

  it("paused buffer still accepts filter toggles and navigation", () => {
    let s = { ...initialState(), paused: true };
    s = reducer(s, { type: "toggle-pause" });
    expect(s.paused).toBe(false);
    s = reducer(s, { type: "toggle-pause" });
    expect(s.paused).toBe(true);
    s = reducer(s, { type: "cycle-filter", agents: ["claude-code"] });
    expect(s.paused).toBe(true);
    expect(s.filterAgent).toBe("claude-code");
  });
});
