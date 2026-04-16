import type { AgentEvent, AgentName } from "../schema.js";

/**
 * Build a tree representing inter-agent calls rooted at a single session.
 *
 *   session(claude-code, sess-A)
 *   ├─ prompt + response turns inside sess-A
 *   ├─ call → codex   "review my plan"
 *   │   └─ session(codex, sess-B)
 *   │       ├─ events inside sess-B
 *   │       └─ call → … (recursive)
 *   └─ call → gemini  "second opinion"
 *       └─ session(gemini, sess-C)
 *           └─ events inside sess-C
 *
 * Linking:
 *  - A `call` node corresponds to an event in the parent session that
 *    has `details.agentCall` (set by the Claude adapter via AUR-199).
 *  - A `session` node under a `call` is found by scanning the full
 *    event buffer for any event whose `details.parentSpawnId === call.id`
 *    (set by the Codex/Gemini adapters via AUR-200), then grouping
 *    those events by their `sessionId`.
 */

export interface CallGraphNode {
  /** "session" = an agent's session scope; "call" = a Bash(<agent>)
   *  invocation inside a parent session. */
  kind: "session" | "call";
  /** For session nodes: which agent + which session. */
  agent?: AgentName;
  sessionId?: string;
  /** For call nodes: callee + extracted prompt. */
  callee?: AgentName;
  prompt?: string;
  /** The originating event id (the call event itself, or the first
   *  event of the session). Used as React key + Enter target. */
  eventId: string;
  /** Wall-clock ms when this scope started. */
  startMs: number;
  /** Aggregate metrics for this scope (and only this scope, not
   *  including descendants). */
  cost: number;
  inputTokens: number;
  outputTokens: number;
  events: number;
  children: CallGraphNode[];
}

interface BuildOpts {
  /** Maximum recursion depth (defensive — pathological loops shouldn't
   *  blow the stack). */
  maxDepth?: number;
}

/** Build the call graph for a root session, walking down all spawned
 *  child sessions transitively. */
export function buildCallGraph(
  allEvents: AgentEvent[],
  rootSessionId: string,
  opts: BuildOpts = {},
): CallGraphNode | null {
  const maxDepth = opts.maxDepth ?? 8;
  const eventsBySession = groupBySession(allEvents);
  const sessionByParentId = indexByParentSpawnId(allEvents);
  return buildSessionNode(
    rootSessionId,
    eventsBySession,
    sessionByParentId,
    maxDepth,
    0,
  );
}

function buildSessionNode(
  sessionId: string,
  bySession: Map<string, AgentEvent[]>,
  byParent: Map<string, AgentEvent[]>,
  maxDepth: number,
  depth: number,
): CallGraphNode | null {
  const sessionEvents = bySession.get(sessionId);
  if (!sessionEvents || sessionEvents.length === 0) return null;
  const sorted = [...sessionEvents].sort((a, b) =>
    a.ts < b.ts ? -1 : 1,
  );
  const first = sorted[0]!;
  const node: CallGraphNode = {
    kind: "session",
    agent: first.agent,
    sessionId,
    eventId: first.id,
    startMs: new Date(first.ts).getTime(),
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    events: sorted.length,
    children: [],
  };
  for (const e of sorted) {
    accumulateMetrics(node, e);
    if (e.details?.agentCall) {
      const callNode = buildCallNode(
        e,
        bySession,
        byParent,
        maxDepth,
        depth,
      );
      if (callNode) node.children.push(callNode);
    }
  }
  return node;
}

function buildCallNode(
  callEvent: AgentEvent,
  bySession: Map<string, AgentEvent[]>,
  byParent: Map<string, AgentEvent[]>,
  maxDepth: number,
  depth: number,
): CallGraphNode {
  const ac = callEvent.details!.agentCall!;
  const node: CallGraphNode = {
    kind: "call",
    callee: ac.callee,
    prompt: ac.prompt,
    eventId: callEvent.id,
    startMs: new Date(callEvent.ts).getTime(),
    cost: callEvent.details?.cost ?? 0,
    inputTokens: callEvent.details?.usage?.input ?? 0,
    outputTokens: callEvent.details?.usage?.output ?? 0,
    events: 1,
    children: [],
  };
  if (depth >= maxDepth) return node;
  // Find the spawned child session(s). A single call typically spawns
  // one child but defensive: a buggy adapter could double-link.
  const spawned = byParent.get(callEvent.id) ?? [];
  const childSessionIds = new Set<string>();
  for (const e of spawned) {
    if (e.sessionId) childSessionIds.add(e.sessionId);
  }
  for (const sid of childSessionIds) {
    const sessionNode = buildSessionNode(
      sid,
      bySession,
      byParent,
      maxDepth,
      depth + 1,
    );
    if (sessionNode) node.children.push(sessionNode);
  }
  return node;
}

function accumulateMetrics(node: CallGraphNode, e: AgentEvent): void {
  if (e.details?.cost) node.cost += e.details.cost;
  if (e.details?.usage) {
    node.inputTokens += e.details.usage.input;
    node.outputTokens += e.details.usage.output;
  }
}

function groupBySession(events: AgentEvent[]): Map<string, AgentEvent[]> {
  const m = new Map<string, AgentEvent[]>();
  for (const e of events) {
    if (!e.sessionId) continue;
    let arr = m.get(e.sessionId);
    if (!arr) {
      arr = [];
      m.set(e.sessionId, arr);
    }
    arr.push(e);
  }
  return m;
}

function indexByParentSpawnId(events: AgentEvent[]): Map<string, AgentEvent[]> {
  const m = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const pid = e.details?.parentSpawnId;
    if (!pid) continue;
    let arr = m.get(pid);
    if (!arr) {
      arr = [];
      m.set(pid, arr);
    }
    arr.push(e);
  }
  return m;
}

/** Sum cost / tokens across the whole subtree rooted here. */
export function aggregateSubtree(node: CallGraphNode): {
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalEvents: number;
  agents: Set<AgentName>;
} {
  let totalCost = node.cost;
  let totalInput = node.inputTokens;
  let totalOutput = node.outputTokens;
  let totalEvents = node.events;
  const agents = new Set<AgentName>();
  if (node.agent) agents.add(node.agent);
  if (node.callee) agents.add(node.callee);
  for (const child of node.children) {
    const sub = aggregateSubtree(child);
    totalCost += sub.totalCost;
    totalInput += sub.totalInput;
    totalOutput += sub.totalOutput;
    totalEvents += sub.totalEvents;
    for (const a of sub.agents) agents.add(a);
  }
  return { totalCost, totalInput, totalOutput, totalEvents, agents };
}

/** Flatten the tree into an ordered list of (depth, node) pairs for
 *  rendering as a single scrollable list. */
export function flatten(
  node: CallGraphNode,
  depth = 0,
): Array<{ depth: number; node: CallGraphNode; isLast: boolean }> {
  const out: Array<{ depth: number; node: CallGraphNode; isLast: boolean }> = [];
  out.push({ depth, node, isLast: false });
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    const sub = flatten(child, depth + 1);
    if (i === node.children.length - 1) {
      sub[0]!.isLast = true;
    }
    out.push(...sub);
  }
  return out;
}
