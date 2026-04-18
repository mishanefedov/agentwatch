import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { detectAgents } from "../../adapters/detect.js";

export function registerAgentRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.get("/api/agents", async () => {
    const agents = detectAgents();
    const counts = new Map<string, { total: number; lastTs?: string }>();
    for (const e of events) {
      const c = counts.get(e.agent) ?? { total: 0 };
      c.total += 1;
      if (!c.lastTs || e.ts > c.lastTs) c.lastTs = e.ts;
      counts.set(e.agent, c);
    }
    return {
      agents: agents.map((a) => ({
        ...a,
        eventCount: counts.get(a.name)?.total ?? 0,
        lastEventAt: counts.get(a.name)?.lastTs ?? null,
      })),
    };
  });
}
