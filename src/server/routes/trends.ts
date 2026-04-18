import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";

/** Bucket events by day. Returns [{ day: "YYYY-MM-DD", ...agg }, ...] */
function byDay<T>(
  events: AgentEvent[],
  days: number,
  initAcc: () => T,
  reducer: (acc: T, e: AgentEvent) => void,
): Array<{ day: string } & T> {
  const out = new Map<string, T>();
  const now = Date.now();
  const cutoff = now - days * 86_400_000;
  // Seed with empty days so the chart has a continuous x-axis.
  for (let i = 0; i < days; i++) {
    const ms = now - i * 86_400_000;
    const day = new Date(ms).toISOString().slice(0, 10);
    out.set(day, initAcc());
  }
  for (const e of events) {
    const tms = new Date(e.ts).getTime();
    if (tms < cutoff) continue;
    const day = e.ts.slice(0, 10);
    if (!out.has(day)) out.set(day, initAcc());
    reducer(out.get(day)!, e);
  }
  return Array.from(out.entries())
    .map(([day, agg]) => ({ day, ...(agg as T) }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function registerTrendsRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.get<{ Querystring: { days?: string } }>("/api/trends/cost", async (req) => {
    const days = clamp(parseInt(req.query.days ?? "30", 10) || 30, 1, 90);
    const data = byDay<{ cost: number; input: number; output: number }>(
      events,
      days,
      () => ({ cost: 0, input: 0, output: 0 }),
      (acc, e) => {
        acc.cost += e.details?.cost ?? 0;
        if (e.details?.usage) {
          acc.input += e.details.usage.input ?? 0;
          acc.output += e.details.usage.output ?? 0;
        }
      },
    );
    return { days, data };
  });

  app.get<{ Querystring: { days?: string } }>("/api/trends/cache-hit", async (req) => {
    const days = clamp(parseInt(req.query.days ?? "30", 10) || 30, 1, 90);
    const data = byDay<{ cacheRead: number; cacheCreate: number; totalInput: number }>(
      events,
      days,
      () => ({ cacheRead: 0, cacheCreate: 0, totalInput: 0 }),
      (acc, e) => {
        const u = e.details?.usage;
        if (!u) return;
        acc.cacheRead += u.cacheRead ?? 0;
        acc.cacheCreate += u.cacheCreate ?? 0;
        acc.totalInput += (u.input ?? 0) + (u.cacheRead ?? 0);
      },
    );
    return {
      days,
      data: data.map((d) => ({
        ...d,
        // Ratio of tokens served from cache vs total input.
        hitRatio: d.totalInput > 0 ? d.cacheRead / d.totalInput : 0,
      })),
    };
  });

  app.get<{ Querystring: { days?: string } }>("/api/trends/by-agent", async (req) => {
    const days = clamp(parseInt(req.query.days ?? "30", 10) || 30, 1, 90);
    // eventCounts per agent per day (wide format for recharts).
    const agents = Array.from(new Set(events.map((e) => e.agent)));
    const data = byDay<Record<string, number>>(
      events,
      days,
      () => Object.fromEntries(agents.map((a) => [a, 0])),
      (acc, e) => {
        acc[e.agent] = (acc[e.agent] ?? 0) + 1;
      },
    );
    return { days, agents, data };
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
