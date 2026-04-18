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
    const limit = clamp(parseInt(req.query.limit ?? "100", 10) || 100, 1, 50_000);
    const beforeMs = req.query.before ? Date.parse(req.query.before) : null;
    // Buffer is stored oldest-first for O(1) append. Walk backwards to
    // build newest-first results without materializing a reversed copy.
    const out: AgentEvent[] = [];
    const needle = req.query.q?.toLowerCase();
    for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = events[i]!;
      if (req.query.agent && e.agent !== req.query.agent) continue;
      if (req.query.session && e.sessionId !== req.query.session) continue;
      if (req.query.type && e.type !== req.query.type) continue;
      if (req.query.project) {
        const pref = `[${req.query.project}`;
        if (!(e.summary ?? "").startsWith(pref)) continue;
      }
      if (beforeMs && !Number.isNaN(beforeMs)) {
        if (new Date(e.ts).getTime() >= beforeMs) continue;
      }
      if (needle && !matchesLive(e, needle)) continue;
      out.push(e);
    }
    return {
      events: out,
      total: events.length,
      returned: out.length,
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
