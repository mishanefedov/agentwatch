import { describe, expect, it } from "vitest";
import {
  aggregateSubtree,
  buildCallGraph,
  flatten,
} from "./call-graph.js";
import type { AgentEvent } from "../schema.js";

const evt = (o: Partial<AgentEvent>): AgentEvent => ({
  id: Math.random().toString(36).slice(2),
  ts: o.ts ?? "2026-04-16T10:00:00Z",
  agent: "claude-code",
  type: "response",
  riskScore: 0,
  ...o,
});

describe("buildCallGraph", () => {
  it("returns null when the root session has no events", () => {
    expect(buildCallGraph([], "missing")).toBeNull();
  });

  it("builds a single-node tree for a session with no agent_calls", () => {
    const events = [
      evt({ id: "e1", sessionId: "s1", ts: "2026-04-16T10:00:00Z" }),
      evt({ id: "e2", sessionId: "s1", ts: "2026-04-16T10:00:05Z" }),
    ];
    const tree = buildCallGraph(events, "s1");
    expect(tree?.kind).toBe("session");
    expect(tree?.events).toBe(2);
    expect(tree?.children).toHaveLength(0);
  });

  it("attaches a call child when an event has details.agentCall", () => {
    const events = [
      evt({
        id: "claudeBash",
        sessionId: "s1",
        type: "shell_exec",
        details: { agentCall: { callee: "codex", kind: "exec", prompt: "review" } },
      }),
    ];
    const tree = buildCallGraph(events, "s1");
    expect(tree?.children).toHaveLength(1);
    expect(tree!.children[0]!.kind).toBe("call");
    expect(tree!.children[0]!.callee).toBe("codex");
  });

  it("links a spawned child session under its parent call event", () => {
    const events: AgentEvent[] = [
      evt({
        id: "claudeBash",
        sessionId: "s1",
        agent: "claude-code",
        type: "shell_exec",
        ts: "2026-04-16T10:00:00Z",
        details: {
          agentCall: { callee: "codex", kind: "exec", prompt: "review" },
        },
      }),
      evt({
        id: "codexFirst",
        sessionId: "s2",
        agent: "codex",
        type: "prompt",
        ts: "2026-04-16T10:00:02Z",
        details: { parentSpawnId: "claudeBash" },
      }),
      evt({
        id: "codexSecond",
        sessionId: "s2",
        agent: "codex",
        type: "response",
        ts: "2026-04-16T10:00:05Z",
        details: { usage: { input: 100, cacheCreate: 0, cacheRead: 0, output: 30 }, cost: 0.01 },
      }),
    ];
    const tree = buildCallGraph(events, "s1");
    const callNode = tree!.children[0]!;
    expect(callNode.children).toHaveLength(1);
    const codexSession = callNode.children[0]!;
    expect(codexSession.kind).toBe("session");
    expect(codexSession.agent).toBe("codex");
    expect(codexSession.sessionId).toBe("s2");
    expect(codexSession.events).toBe(2);
    expect(codexSession.cost).toBeCloseTo(0.01);
  });

  it("recurses through nested agent_calls", () => {
    const events: AgentEvent[] = [
      evt({ id: "a1", sessionId: "s1", agent: "claude-code", ts: "10:00:00Z",
        type: "shell_exec",
        details: { agentCall: { callee: "codex", kind: "exec" } } }),
      evt({ id: "b1", sessionId: "s2", agent: "codex", ts: "10:00:01Z",
        type: "shell_exec",
        details: { parentSpawnId: "a1", agentCall: { callee: "gemini", kind: "exec" } } }),
      evt({ id: "c1", sessionId: "s3", agent: "gemini", ts: "10:00:02Z",
        type: "prompt",
        details: { parentSpawnId: "b1" } }),
    ];
    const tree = buildCallGraph(events, "s1");
    expect(tree!.children[0]!.callee).toBe("codex");
    const codexSession = tree!.children[0]!.children[0]!;
    expect(codexSession.children[0]!.callee).toBe("gemini");
  });
});

describe("aggregateSubtree", () => {
  it("sums cost and tokens across the whole subtree", () => {
    const events: AgentEvent[] = [
      evt({ id: "a1", sessionId: "s1", type: "response",
        details: { usage: { input: 50, cacheCreate: 0, cacheRead: 0, output: 10 }, cost: 0.005 } }),
      evt({ id: "a2", sessionId: "s1", type: "shell_exec",
        details: { cost: 0.001, agentCall: { callee: "codex", kind: "exec" } } }),
      evt({ id: "b1", sessionId: "s2", agent: "codex",
        details: { parentSpawnId: "a2", usage: { input: 200, cacheCreate: 0, cacheRead: 0, output: 50 }, cost: 0.02 } }),
    ];
    const tree = buildCallGraph(events, "s1")!;
    const agg = aggregateSubtree(tree);
    expect(agg.totalCost).toBeCloseTo(0.026);
    expect(agg.totalInput).toBe(250);
    expect(agg.totalOutput).toBe(60);
    expect(agg.agents.has("claude-code")).toBe(true);
    expect(agg.agents.has("codex")).toBe(true);
  });
});

describe("flatten", () => {
  it("produces an in-order list with depth + isLast info", () => {
    const events: AgentEvent[] = [
      evt({ id: "a1", sessionId: "s1", type: "shell_exec",
        details: { agentCall: { callee: "codex", kind: "exec" } } }),
      evt({ id: "a2", sessionId: "s1", type: "shell_exec",
        details: { agentCall: { callee: "gemini", kind: "exec" } } }),
    ];
    const tree = buildCallGraph(events, "s1")!;
    const flat = flatten(tree);
    expect(flat).toHaveLength(3); // root + 2 calls
    expect(flat[2]!.isLast).toBe(true);
  });
});
