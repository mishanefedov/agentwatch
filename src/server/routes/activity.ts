import type { FastifyInstance } from "fastify";
import type { EventStore } from "../../store/sqlite.js";

/** Per-category activity rollups for a session or project. Routes return
 *  empty arrays when no store is attached or no matching data exists —
 *  the UI is responsible for showing an empty-state instead of a 404,
 *  because "this session has zero events of any category" is meaningful. */
export function registerActivityRoutes(
  app: FastifyInstance,
  store?: EventStore,
): void {
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/activity",
    async (req) => {
      const id = decodeURIComponent(req.params.id);
      if (!store) return { sessionId: id, buckets: [] };
      return { sessionId: id, buckets: store.activityBySession(id) };
    },
  );

  app.get<{ Params: { name: string } }>(
    "/api/projects/:name/activity",
    async (req) => {
      const name = decodeURIComponent(req.params.name);
      if (!store) return { project: name, buckets: [] };
      return { project: name, buckets: store.activityByProject(name) };
    },
  );
}
