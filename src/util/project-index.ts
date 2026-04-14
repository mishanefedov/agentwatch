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
