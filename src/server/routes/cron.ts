import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { readCronJobs } from "../../util/openclaw-cron.js";
import { readAllHeartbeats } from "../../util/openclaw-heartbeat.js";

export function registerCronRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.get("/api/cron", async () => {
    return {
      jobs: readCronJobs(),
      heartbeats: readAllHeartbeats(),
      // events is oldest-first; reverse the last 200 to show newest first.
      scheduledEvents: events
        .filter((e) => e.details?.scheduled)
        .slice(-200)
        .reverse(),
    };
  });
}
