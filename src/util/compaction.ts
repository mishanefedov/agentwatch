import type { AgentEvent } from "../schema.js";

/**
 * Compaction visualizer data model. Walks the events of a single session
 * in chronological order and produces one CompactionPoint per assistant
 * turn (or per compaction marker), with the context fill % at that
 * moment.
 */

/** Default context window we assume when a model-specific number isn't
 *  known. 200k covers Claude 3.5/3.6 Sonnet + Opus. Users can override
 *  via `AGENTWATCH_CONTEXT_WINDOW`. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

export interface CompactionPoint {
  kind: "turn" | "compaction";
  ts: string;
  /** Context fill in [0,1]. For compaction points, the BEFORE value. */
  fillBefore: number;
  /** For compaction points, the fill after the reset (usually ~0). */
  fillAfter?: number;
  /** Tokens making up the before value (assistant turns only). */
  tokensBefore?: number;
  tokensAfter?: number;
  /** Human label for the x-axis. */
  label: string;
}

export interface CompactionSeries {
  sessionId: string;
  contextWindow: number;
  points: CompactionPoint[];
  compactionCount: number;
  maxFill: number;
}

export function contextWindow(): number {
  const env = process.env.AGENTWATCH_CONTEXT_WINDOW;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/** Build the context-fill time series for a session. */
export function buildCompactionSeries(
  events: AgentEvent[],
  sessionId: string,
  window: number = contextWindow(),
): CompactionSeries {
  const inSession = events
    .filter((e) => e.sessionId === sessionId)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  const points: CompactionPoint[] = [];
  let compactionCount = 0;
  let maxFill = 0;
  let turnIdx = 0;
  let lastFill = 0;
  let lastTokens = 0;

  for (const e of inSession) {
    if (e.type === "compaction") {
      compactionCount += 1;
      points.push({
        kind: "compaction",
        ts: e.ts,
        fillBefore: lastFill,
        fillAfter: 0,
        tokensBefore: lastTokens,
        tokensAfter: 0,
        label: "⋈",
      });
      lastFill = 0;
      lastTokens = 0;
      continue;
    }
    const u = e.details?.usage;
    if (!u) continue;
    turnIdx += 1;
    const tokens = u.input + u.cacheRead + u.cacheCreate;
    const fill = Math.min(1, tokens / window);
    if (fill > maxFill) maxFill = fill;
    lastFill = fill;
    lastTokens = tokens;
    points.push({
      kind: "turn",
      ts: e.ts,
      fillBefore: fill,
      tokensBefore: tokens,
      label: `t${turnIdx}`,
    });
  }

  return {
    sessionId,
    contextWindow: window,
    points,
    compactionCount,
    maxFill,
  };
}

/** Render the series to a single ASCII line ≤ maxWidth chars. Turns use
 *  Unicode block characters whose height encodes fill %. Compactions
 *  are rendered as `⋈`. */
export function renderCompactionBar(
  series: CompactionSeries,
  maxWidth: number,
): string {
  if (series.points.length === 0) return "";
  const blocks = " ▁▂▃▄▅▆▇█";
  const points = series.points.slice(-maxWidth); // tail-fit if too long
  let out = "";
  for (const p of points) {
    if (p.kind === "compaction") {
      out += "⋈";
      continue;
    }
    const idx = Math.min(
      blocks.length - 1,
      Math.max(0, Math.round(p.fillBefore * (blocks.length - 1))),
    );
    out += blocks[idx]!;
  }
  return out;
}
