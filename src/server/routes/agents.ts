import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { detectAgents } from "../../adapters/detect.js";

export function registerAgentRoutes(
  app: FastifyInstance,
  _events: AgentEvent[],
  byAgent: Map<string, AgentEvent[]>,
): void {
  app.get("/api/agents", async () => {
    const agents = detectAgents();
    return {
      agents: agents.map((a) => {
        const bucket = byAgent.get(a.name);
        // Buckets are insertion-order; the max ts may be anywhere
        // inside (adapter backfill can replay old and new session
        // files interleaved). Walk to find it.
        let maxTs: string | null = null;
        if (bucket) {
          for (const e of bucket) if (!maxTs || e.ts > maxTs) maxTs = e.ts;
        }
        return {
          ...a,
          eventCount: bucket?.length ?? 0,
          lastEventAt: maxTs,
        };
      }),
    };
  });
}
