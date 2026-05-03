import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { buildProjectIndex, buildSessionRows } from "../../util/project-index.js";
import type { EventStore } from "../../store/sqlite.js";

export function registerProjectRoutes(app: FastifyInstance, events: AgentEvent[], store?: EventStore): void {
  app.get("/api/projects", async () => {
    // If store is available, use listProjects(). It returns exact ProjectSummary 
    // which matches the shape returned by the legacy buildProjectIndex mapping.
    if (store) {
      return { projects: store.listProjects() };
    }
    const rows = buildProjectIndex(events).map((p) => ({
      name: p.name,
      eventCount: p.events,
      byAgent: Object.fromEntries(p.byAgent),
      sessionIds: Array.from(p.sessions),
      cost: p.cost,
      lastTs: p.lastTs,
    }));
    return { projects: rows };
  });

  app.get<{ Params: { name: string } }>(
    "/api/projects/:name/sessions",
    async (req) => {
      const name = decodeURIComponent(req.params.name);
      if (store) {
        const sessions = store.listSessions({ project: name }).map((s) => ({
          sessionId: s.sessionId,
          agent: s.agent,
          project: s.project || name,
          eventCount: s.eventCount,
          events: s.eventCount, // for consumers expecting SessionRow
          cost: s.costUsd,
          firstTs: s.firstTs,
          lastTs: s.lastTs,
          firstPrompt: "",
        }));
        return { project: name, sessions };
      }
      const sessions = buildSessionRows(events, name).map(r => ({
        ...r,
        eventCount: r.events,
      }));
      return { project: name, sessions };
    },
  );
}
