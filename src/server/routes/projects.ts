import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { buildProjectIndex, buildSessionRows } from "../../util/project-index.js";

export function registerProjectRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.get("/api/projects", async () => {
    // buildProjectIndex returns Map/Set fields which don't JSON-serialize.
    // Flatten for the wire format.
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
      const sessions = buildSessionRows(events, name);
      return { project: name, sessions };
    },
  );
}
