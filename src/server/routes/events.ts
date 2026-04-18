import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";

interface EventQuery {
  limit?: string;
  before?: string; // ISO ts cursor — return events strictly before this ts
  project?: string;
  agent?: string;
  session?: string;
  type?: string;
  q?: string; // live substring search
}

export function registerEventRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.get<{ Querystring: EventQuery }>("/api/events", async (req) => {
    const limit = clamp(parseInt(req.query.limit ?? "100", 10) || 100, 1, 1000);
    const beforeMs = req.query.before ? Date.parse(req.query.before) : null;
    let out: AgentEvent[] = events;
    if (req.query.agent) out = out.filter((e) => e.agent === req.query.agent);
    if (req.query.session) out = out.filter((e) => e.sessionId === req.query.session);
    if (req.query.type) out = out.filter((e) => e.type === req.query.type);
    if (req.query.project) {
      const pref = `[${req.query.project}`;
      out = out.filter((e) => (e.summary ?? "").startsWith(pref));
    }
    if (beforeMs && !Number.isNaN(beforeMs)) {
      out = out.filter((e) => new Date(e.ts).getTime() < beforeMs);
    }
    if (req.query.q) {
      const needle = req.query.q.toLowerCase();
      out = out.filter((e) => matchesLive(e, needle));
    }
    return {
      events: out.slice(0, limit),
      total: events.length,
      returned: Math.min(out.length, limit),
    };
  });

  app.get<{ Params: { id: string } }>("/api/events/:id", async (req, reply) => {
    const ev = events.find((e) => e.id === req.params.id);
    if (!ev) {
      reply.code(404);
      return { error: "event not found" };
    }
    return { event: ev };
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function matchesLive(e: AgentEvent, needle: string): boolean {
  if ((e.summary ?? "").toLowerCase().includes(needle)) return true;
  if ((e.path ?? "").toLowerCase().includes(needle)) return true;
  if ((e.cmd ?? "").toLowerCase().includes(needle)) return true;
  if ((e.tool ?? "").toLowerCase().includes(needle)) return true;
  if ((e.agent ?? "").toLowerCase().includes(needle)) return true;
  const d = e.details;
  if (d?.fullText && d.fullText.toLowerCase().includes(needle)) return true;
  if (d?.thinking && d.thinking.toLowerCase().includes(needle)) return true;
  return false;
}
