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

  search: (query: string, mode: "live" | "cross" | "semantic" = "live", limit = 100) =>
    postJson<{ mode: string; hits: Array<any>; status?: string; error?: string }>(
      "/api/search",
      { query, mode, limit },
    ),

  agents: () => getJson<{ agents: DetectedAgent[] }>("/api/agents"),

  permissions: () => getJson<any>("/api/permissions"),

  cron: () => getJson<{ jobs: any[]; heartbeats: any[]; scheduledEvents: AgentEvent[] }>("/api/cron"),
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
