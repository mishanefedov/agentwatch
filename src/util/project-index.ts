import type { AgentEvent, AgentName } from "../schema.js";

export interface ProjectRow {
  /** Short label extracted from event prefix (`[auraqu]` → `auraqu`). */
  name: string;
  /** Total events across every agent in this project. */
  events: number;
  /** Per-agent event count. */
  byAgent: Map<AgentName, number>;
  /** Unique session ids touching this project. */
  sessions: Set<string>;
  /** Accumulated cost across all assistant turns in this project. */
  cost: number;
  /** Most recent event timestamp (ISO). */
  lastTs: string;
}

/** Derive the project index from the full event buffer. Cheap enough to
 *  recompute on every render for <5k events. Memoize via useMemo if hot. */
export function buildProjectIndex(events: AgentEvent[]): ProjectRow[] {
  const byName = new Map<string, ProjectRow>();
  for (const e of events) {
    const name = extractProjectName(e);
    if (!name) continue;
    let row = byName.get(name);
    if (!row) {
      row = {
        name,
        events: 0,
        byAgent: new Map(),
        sessions: new Set(),
        cost: 0,
        lastTs: e.ts,
      };
      byName.set(name, row);
    }
    row.events += 1;
    row.byAgent.set(e.agent, (row.byAgent.get(e.agent) ?? 0) + 1);
    if (e.sessionId) row.sessions.add(e.sessionId);
    if (e.details?.cost) row.cost += e.details.cost;
    if (e.ts > row.lastTs) row.lastTs = e.ts;
  }
  const rows = Array.from(byName.values());
  rows.sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1));
  return rows;
}

function extractProjectName(e: AgentEvent): string | null {
  const s = e.summary ?? "";
  const m = s.match(/^\[([^\]/ ]+)/);
  if (m) return m[1] ?? null;
  // fall through for openclaw config.write events without a prefix
  return null;
}

export function agoFromNow(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export interface SessionRow {
  sessionId: string;
  agent: AgentName;
  /** Sub-agent label for OpenClaw (content/research/etc.). */
  subAgent?: string;
  project: string;
  firstPrompt: string;
  events: number;
  firstTs: string;
  lastTs: string;
  cost: number;
  hasError: boolean;
}

/** Return one row per session in a given project, newest first. */
export function buildSessionRows(
  events: AgentEvent[],
  project: string,
): SessionRow[] {
  const byId = new Map<string, SessionRow>();
  for (const e of events) {
    const p = (e.summary ?? "").match(/^\[([^\]/ ]+)/)?.[1];
    if (p !== project) continue;
    const sid = e.sessionId;
    if (!sid) continue;
    let row = byId.get(sid);
    if (!row) {
      row = {
        sessionId: sid,
        agent: e.agent,
        subAgent: extractSubAgent(e),
        project,
        firstPrompt: "",
        events: 0,
        firstTs: e.ts,
        lastTs: e.ts,
        cost: 0,
        hasError: false,
      };
      byId.set(sid, row);
    }
    row.events += 1;
    if (e.ts < row.firstTs) row.firstTs = e.ts;
    if (e.ts > row.lastTs) row.lastTs = e.ts;
    if (e.details?.cost) row.cost += e.details.cost;
    if (e.details?.toolError) row.hasError = true;
    if (!row.firstPrompt && e.type === "prompt" && e.details?.fullText) {
      row.firstPrompt = e.details.fullText.trim().slice(0, 200);
    }
  }
  const rows = Array.from(byId.values());
  rows.sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1));
  return rows;
}

/** Classic relative date bucket for session grouping. */
export function dateBucket(iso: string): "today" | "yesterday" | "7d" | "older" {
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) return "today";
  if (diffMs < 48 * 3600_000) return "yesterday";
  if (diffMs < 7 * 86400_000) return "7d";
  return "older";
}

function extractSubAgent(e: AgentEvent): string | undefined {
  const tool = e.tool ?? "";
  // openclaw:content / openclaw:research / openclaw:content:Bash
  const m = tool.match(/^openclaw:([^:]+)/);
  if (m) return m[1];
  return undefined;
}
