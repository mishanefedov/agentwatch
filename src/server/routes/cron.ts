import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { readCronJobs } from "../../util/openclaw-cron.js";
import { readAllHeartbeats } from "../../util/openclaw-heartbeat.js";

export function registerCronRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.get("/api/cron", async () => {
    return {
      jobs: readCronJobs(),
      heartbeats: readAllHeartbeats(),
      scheduledEvents: events.filter((e) => e.details?.scheduled).slice(0, 200),
    };
  });
}
