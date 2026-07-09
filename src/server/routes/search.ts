import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";
import { searchAllSessions } from "../../util/cross-search.js";
import type { EventStore } from "../../store/sqlite.js";

interface SearchBody {
  query: string;
  mode?: "live" | "cross" | "semantic" | "history";
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

export function registerSearchRoutes(
  app: FastifyInstance,
  events: AgentEvent[],
  store?: EventStore,
): void {
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

    if (mode === "history") {
      if (!store) {
        return {
          mode,
          hits: [],
          status: "history mode requires a SQLite store — pass --no-web off and ensure ~/.agentwatch is writable",
        };
      }
      const hits = store.searchFts(query, { limit }).map((h) => ({
        kind: "history" as const,
        hit: {
          eventId: h.eventId,
          sessionId: h.sessionId,
          agent: h.agent,
          ts: h.ts,
          type: h.type,
          snippet: h.snippet,
          rank: h.rank,
        },
      }));
      return { mode, hits };
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

    // Semantic: lazy-import so the model download only happens once a
    // semantic search is actually requested.
    try {
      const {
        searchHybrid,
        hasIndex,
        indexStats,
        loadEmbedder,
        searchBm25Only,
        readReindexMeta,
      } = await import("../../util/semantic-index.js");
      const { shouldSpawnReindex, spawnDetachedReindex } = await import(
        "../../util/reindex-spawner.js"
      );

      const idxExists = hasIndex();
      const stats = idxExists ? indexStats() : { turns: 0, vectors: 0 };
      const meta = readReindexMeta();
      // The build always runs out-of-process (`agentwatch reindex`,
      // detached + unref'd) — never inline here — so a request never
      // blocks the shared event loop the TUI and this server share.
      // claimReindexLock() inside the subprocess is what actually
      // prevents duplicate concurrent builds; this is just "is it worth
      // spawning one" so we don't fork on every keystroke.
      if (shouldSpawnReindex(meta, idxExists, stats.vectors)) {
        spawnDetachedReindex();
      }

      if (!idxExists || stats.vectors === 0) {
        // Bail out to BM25 rather than blocking on the index build (which
        // includes a one-time ~80MB model download). Surface a status so
        // the UI can show progress instead of a silent stall.
        const hits = searchBm25Only(query, limit);
        const fresh = readReindexMeta();
        const status =
          fresh.status === "running"
            ? `semantic index building in the background (${fresh.embeddedTurns}/${fresh.queuedTurns} turns embedded so far) — showing BM25 results for now`
            : "semantic index not built yet — a background build just started (agentwatch reindex). Showing BM25 results for now.";
        return {
          mode,
          hits: hits.map((h) => ({ kind: "semantic" as const, hit: h })),
          status,
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
