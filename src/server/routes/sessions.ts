import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { attributeTokens, attributeTurns } from "../../util/token-attribution.js";
import { buildCallGraph } from "../../util/call-graph.js";
import { buildCompactionSeries } from "../../util/compaction.js";
import { exportSession, sessionToMarkdown } from "../../util/export.js";

export function registerSessionRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  // Full events for a session.
  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    const id = decodeURIComponent(req.params.id);
    const sessionEvents = events.filter((e) => e.sessionId === id);
    if (sessionEvents.length === 0) {
      reply.code(404);
      return { error: "session not found (or events not yet loaded)" };
    }
    const first = sessionEvents[sessionEvents.length - 1];
    return {
      sessionId: id,
      agent: first?.agent,
      events: sessionEvents,
    };
  });

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/tokens",
    async (req) => {
      const id = decodeURIComponent(req.params.id);
      return {
        sessionId: id,
        breakdown: attributeTokens(events, id),
        turns: attributeTurns(events, id),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/compaction",
    async (req) => {
      const id = decodeURIComponent(req.params.id);
      return {
        sessionId: id,
        series: buildCompactionSeries(events, id),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/graph",
    async (req) => {
      const id = decodeURIComponent(req.params.id);
      return {
        sessionId: id,
        graph: buildCallGraph(events, id),
      };
    },
  );

  // Export — either as stream or as written file path.
  app.get<{ Params: { id: string }; Querystring: { format?: string; inline?: string } }>(
    "/api/sessions/:id/export",
    async (req, reply) => {
      const id = decodeURIComponent(req.params.id);
      const sessionEvents = events.filter((e) => e.sessionId === id);
      if (sessionEvents.length === 0) {
        reply.code(404);
        return { error: "session not found" };
      }
      const agent = sessionEvents[0]?.agent ?? "unknown";
      const format = req.query.format === "json" ? "json" : "md";
      // inline=1: return content directly, don't write to disk.
      if (req.query.inline === "1") {
        if (format === "json") {
          reply.header("Content-Type", "application/json");
          return { sessionId: id, agent, events: sessionEvents };
        }
        reply.header("Content-Type", "text/markdown");
        return sessionToMarkdown(sessionEvents, id, agent);
      }
      const res = exportSession(sessionEvents, id, agent);
      return res;
    },
  );
}
