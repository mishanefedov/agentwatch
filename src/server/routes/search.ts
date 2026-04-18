import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { searchAllSessions } from "../../util/cross-search.js";

interface SearchBody {
  query: string;
  mode?: "live" | "cross" | "semantic";
  limit?: number;
  /** Optional ISO timestamps narrowing the window (cross mode only — live
   *  is ring-buffer scoped already). */
  since?: string;
  until?: string;
  /** Optional agent allowlist. */
  agents?: string[];
}

/* Timestamp extraction lives in cross-search.ts/sniffTs — hits carry
 * a `ts` field when the JSONL line included one. */

export function registerSearchRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.post<{ Body: SearchBody }>("/api/search", async (req, reply) => {
    const query = (req.body?.query ?? "").trim();
    const mode = req.body?.mode ?? "live";
    const limit = clamp(req.body?.limit ?? 100, 1, 500);

    if (!query) {
      return { mode, hits: [] };
    }

    if (mode === "live") {
      const needle = query.toLowerCase();
      // events is oldest-first; walk backwards so top hits are newest.
      const hits: typeof events = [];
      for (let i = events.length - 1; i >= 0 && hits.length < limit; i--) {
        const e = events[i]!;
        if (matchesLive(e, needle)) hits.push(e);
      }
      return { mode, hits: hits.map((e) => ({ kind: "live" as const, event: e })) };
    }

    if (mode === "cross") {
      // Pull generously, then apply agent + date filters before capping.
      const raw = searchAllSessions(query, Math.max(limit, 300));
      const sinceMs = req.body?.since ? Date.parse(req.body.since) : null;
      const untilMs = req.body?.until ? Date.parse(req.body.until) : null;
      const agentFilter = req.body?.agents && req.body.agents.length > 0
        ? new Set(req.body.agents)
        : null;
      const enriched = raw
        .filter((h) => {
          if (agentFilter && !agentFilter.has(h.agent)) return false;
          if (sinceMs != null && h.ts && Date.parse(h.ts) < sinceMs) return false;
          if (untilMs != null && h.ts && Date.parse(h.ts) > untilMs) return false;
          return true;
        })
        .slice(0, limit);
      return {
        mode,
        hits: enriched.map((h) => ({ kind: "cross" as const, hit: h })),
        totalScanned: raw.length,
      };
    }

    // Semantic: lazy-import so the model download only happens on first request.
    try {
      const { searchHybrid, hasIndex, indexStats, loadEmbedder, searchBm25Only } =
        await import("../../util/semantic-index.js");
      if (!hasIndex() || indexStats().vectors === 0) {
        // Bail out to BM25 rather than blocking for a ~80MB model download
        // on a web request. Surface a status so the UI can show a hint.
        const hits = searchBm25Only(query, limit);
        return {
          mode,
          hits: hits.map((h) => ({ kind: "semantic" as const, hit: h })),
          status: "semantic index not built — running BM25 fallback. Build via: agentwatch (press / → semantic mode in TUI)",
        };
      }
      const embed = await loadEmbedder();
      const qvec = await embed(query);
      const hits = await searchHybrid(query, new Float32Array(qvec), limit);
      return {
        mode,
        hits: hits.map((h) => ({ kind: "semantic" as const, hit: h })),
      };
    } catch (err) {
      reply.code(500);
      return { mode, hits: [], error: String(err).slice(0, 200) };
    }
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
