import type { AgentEvent, DetectedAgent } from "./types";

const API_BASE = (() => {
  // In dev (Vite :5173) we proxy /api to :3456 via vite.config.ts.
  // In production the UI is served by the same origin, so relative paths work.
  return "";
})();

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => getJson<{ ok: boolean; version: string }>("/api/health"),

  events: (params: {
    limit?: number;
    agent?: string;
    session?: string;
    project?: string;
    type?: string;
    q?: string;
    before?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") qs.set(k, String(v));
    }
    return getJson<{ events: AgentEvent[]; total: number; returned: number }>(
      `/api/events?${qs.toString()}`,
    );
  },

  event: (id: string) => getJson<{ event: AgentEvent }>(`/api/events/${encodeURIComponent(id)}`),

  projects: () =>
    getJson<{ projects: Array<{ name: string; eventCount: number; cost: number; lastTs?: string; sessionIds: string[] }> }>(
      "/api/projects",
    ),

  projectSessions: (name: string) =>
    getJson<{ project: string; sessions: Array<any> }>(
      `/api/projects/${encodeURIComponent(name)}/sessions`,
    ),

  session: (id: string) =>
    getJson<{ sessionId: string; agent: string; events: AgentEvent[] }>(
      `/api/sessions/${encodeURIComponent(id)}`,
    ),

  sessionTokens: (id: string) =>
    getJson<{ sessionId: string; breakdown: any; turns: any[] }>(
      `/api/sessions/${encodeURIComponent(id)}/tokens`,
    ),

  sessionCompaction: (id: string) =>
    getJson<{ sessionId: string; series: any }>(
      `/api/sessions/${encodeURIComponent(id)}/compaction`,
    ),

  sessionGraph: (id: string) =>
    getJson<{ sessionId: string; graph: any }>(
      `/api/sessions/${encodeURIComponent(id)}/graph`,
    ),

  sessionActivity: (id: string) =>
    getJson<{
      sessionId: string;
      buckets: Array<{ category: string; eventCount: number; costUsd: number }>;
    }>(`/api/sessions/${encodeURIComponent(id)}/activity`),

  projectActivity: (name: string) =>
    getJson<{
      project: string;
      buckets: Array<{
        category: string;
        eventCount: number;
        costUsd: number;
        sessionsTouched?: number;
      }>;
    }>(`/api/projects/${encodeURIComponent(name)}/activity`),

  sessionYield: (id: string) =>
    getJson<
      | {
          sessionId: string;
          ok: true;
          project: string;
          repoPath: string;
          yield: {
            sessionId: string;
            costUsd: number;
            commits: Array<{
              hash: string;
              authorDate: string;
              authorName: string;
              filesChanged: number;
              insertions: number;
              deletions: number;
              subject: string;
            }>;
            totalInsertions: number;
            totalDeletions: number;
            totalFilesChanged: number;
            costPerCommit: number | null;
            costPerLineChanged: number | null;
          };
        }
      | { sessionId: string; ok: false; reason: string }
    >(`/api/sessions/${encodeURIComponent(id)}/yield`),

  projectYield: (name: string) =>
    getJson<
      | {
          project: string;
          ok: true;
          repoPath: string;
          yield: {
            project: string;
            weekly: Array<{
              weekStart: string;
              costUsd: number;
              commits: number;
              costPerCommit: number | null;
            }>;
            spendWithoutCommit: Array<{
              sessionId: string;
              costUsd: number;
              commits: never[];
              totalInsertions: number;
              totalDeletions: number;
              totalFilesChanged: number;
              costPerCommit: number | null;
              costPerLineChanged: number | null;
            }>;
          };
        }
      | { project: string; ok: false; reason: string }
    >(`/api/projects/${encodeURIComponent(name)}/yield`),

  search: (
    query: string,
    mode: "live" | "cross" | "semantic" = "live",
    limit = 100,
    opts: { since?: string; until?: string; agents?: string[] } = {},
  ) =>
    postJson<{
      mode: string;
      hits: Array<any>;
      status?: string;
      error?: string;
      totalScanned?: number;
    }>("/api/search", { query, mode, limit, ...opts }),

  agents: () => getJson<{ agents: DetectedAgent[] }>("/api/agents"),

  permissions: () => getJson<any>("/api/permissions"),

  cron: () => getJson<{ jobs: any[]; heartbeats: any[]; scheduledEvents: AgentEvent[] }>("/api/cron"),

  config: (kind: "budgets" | "anomaly" | "triggers") =>
    getJson<{ kind: string; path: string; value: any; defaults: any }>(`/api/config/${kind}`),

  saveConfig: async (kind: "budgets" | "anomaly" | "triggers", value: unknown) => {
    const r = await fetch(`/api/config/${kind}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j;
  },

  trendsCost: (days = 30) =>
    getJson<{ days: number; data: Array<{ day: string; cost: number; input: number; output: number }> }>(
      `/api/trends/cost?days=${days}`,
    ),

  trendsCacheHit: (days = 30) =>
    getJson<{ days: number; data: Array<{ day: string; cacheRead: number; cacheCreate: number; totalInput: number; hitRatio: number }> }>(
      `/api/trends/cache-hit?days=${days}`,
    ),

  trendsByAgent: (days = 30) =>
    getJson<{ days: number; agents: string[]; data: Array<Record<string, any>> }>(
      `/api/trends/by-agent?days=${days}`,
    ),

  sessionDiffs: (id: string) =>
    getJson<{ sessionId: string; diffs: Array<any>; count: number }>(
      `/api/sessions/${encodeURIComponent(id)}/diffs`,
    ),

  replay: (id: string, body: { prompt?: string; binaryPath?: string; timeoutSec?: number }) =>
    postJson<{
      ok: boolean;
      exitCode?: number;
      agent: string;
      prompt: string;
      command: string;
      durationMs: number;
      stdout: string;
      stderr: string;
      error?: string;
    }>(`/api/sessions/${encodeURIComponent(id)}/replay`, body),
};

/** Subscribe to the live event stream. Returns an unsubscribe fn. */
export function subscribeEvents(
  onEvent: (e: AgentEvent) => void,
  onHello?: () => void,
): () => void {
  const src = new EventSource(`${API_BASE}/api/events/stream`);
  if (onHello) {
    src.addEventListener("hello", () => onHello());
  }
  src.addEventListener("event", (ev: MessageEvent) => {
    try {
      const e = JSON.parse(ev.data) as AgentEvent;
      onEvent(e);
    } catch {
      // drop malformed frame
    }
  });
  return () => src.close();
}
