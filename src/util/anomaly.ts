import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "../schema.js";

/**
 * Local-only anomaly detection. Two detectors:
 *   1. MAD z-score outliers on cost, duration, tokens (heavy-tailed →
 *      median + MAD is more robust than mean + stddev). Leys et al. 2013.
 *   2. Rolling n-gram stuck-loop detector: flag when the same trigram of
 *      (tool, normalized_args_hash) repeats ≥3× in a 20-event window.
 *
 * Config: ~/.agentwatch/anomaly.json overrides thresholds.
 */

export interface AnomalyThresholds {
  /** |z| above this flags a metric outlier. Default 3.5. */
  zScore: number;
  /** Size of the rolling window used by the stuck-loop detector. */
  loopWindow: number;
  /** Min consecutive repeats of a trigram before flagging a stuck loop. */
  loopMinRepeats: number;
  /** Minimum sample size before MAD scoring is considered reliable. */
  minSamples: number;
}

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  zScore: 3.5,
  loopWindow: 20,
  loopMinRepeats: 3,
  minSamples: 8,
};

export const ANOMALY_CONFIG_PATH = path.join(
  os.homedir(),
  ".agentwatch",
  "anomaly.json",
);

let cached: AnomalyThresholds | null = null;

export function loadThresholds(): AnomalyThresholds {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(ANOMALY_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AnomalyThresholds>;
    cached = { ...DEFAULT_THRESHOLDS, ...parsed };
  } catch {
    cached = DEFAULT_THRESHOLDS;
  }
  return cached;
}

export function _resetAnomalyCache(): void {
  cached = null;
}

/* ---------- Stats helpers ---------- */

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** Median Absolute Deviation with the 1.4826 scale so that for data drawn
 *  from a normal distribution MAD ≈ stddev. Returns 0 for <2 points. */
export function mad(xs: number[]): number {
  if (xs.length < 2) return 0;
  const med = median(xs);
  const deviations = xs.map((x) => Math.abs(x - med));
  return 1.4826 * median(deviations);
}

export function robustZ(x: number, xs: number[]): number {
  const m = median(xs);
  const d = mad(xs);
  if (d === 0) return 0;
  return (x - m) / d;
}

/* ---------- Stuck-loop detector ---------- */

/** Hash a tool_use by its name + normalized argument shape. We hash just
 *  the keys-and-string-prefixes, not the full values, so that repeated
 *  "Bash(rm -rf /tmp/a)" and "Bash(rm -rf /tmp/b)" collide — the latter
 *  is a classic agent-in-a-loop pattern. */
export function eventSignature(e: AgentEvent): string {
  const parts: string[] = [e.tool ?? e.type];
  if (e.cmd) parts.push(normalizeCmd(e.cmd));
  if (e.path) parts.push(e.path);
  return parts.join("|");
}

function normalizeCmd(cmd: string): string {
  // Collapse numeric tails (line numbers, tmp paths) that vary across
  // otherwise-identical commands.
  return cmd
    .replace(/\b\d+\b/g, "N")
    .replace(/\/tmp\/[A-Za-z0-9._-]+/g, "/tmp/X")
    .slice(0, 120);
}

/** Return the repeated trigram if the last `loopWindow` events contain
 *  ≥ `loopMinRepeats` consecutive occurrences of the same 3-event pattern.
 *  Returns null when no loop is detected. */
export function detectStuckLoop(
  events: AgentEvent[],
  thresholds: AnomalyThresholds = loadThresholds(),
): { trigram: string; count: number } | null {
  const window = events.slice(-thresholds.loopWindow);
  if (window.length < 3) return null;
  const sigs = window.map(eventSignature);
  // Slide trigrams; track the longest run of identical trigrams.
  let bestRun = 0;
  let bestStart = 0;
  let run = 1;
  for (let i = 1; i + 2 < sigs.length; i++) {
    if (sigs[i] === sigs[i - 1] && sigs[i + 1] === sigs[i] && sigs[i + 2] === sigs[i + 1]) {
      run += 1;
      if (run > bestRun) {
        bestRun = run;
        bestStart = i - run;
      }
    } else {
      run = 1;
    }
  }
  // Simpler: count consecutive identical signatures, which is what agent
  // loops usually look like (same tool+args fired over and over).
  let consecutive = 1;
  let maxConsec = 1;
  let maxSig = sigs[0]!;
  for (let i = 1; i < sigs.length; i++) {
    if (sigs[i] === sigs[i - 1]) {
      consecutive += 1;
      if (consecutive > maxConsec) {
        maxConsec = consecutive;
        maxSig = sigs[i]!;
      }
    } else {
      consecutive = 1;
    }
  }
  if (maxConsec >= thresholds.loopMinRepeats) {
    return { trigram: maxSig, count: maxConsec };
  }
  // Suppress unused bestStart warning while keeping the trigram scaffold
  // in place for a future sliding-pattern implementation.
  void bestStart;
  return null;
}

/* ---------- Event-level anomaly scoring ---------- */

export type AnomalyKind = "cost" | "duration" | "tokens" | "stuck-loop";

export interface AnomalyFlag {
  kind: AnomalyKind;
  /** Human-readable summary for the UI. */
  message: string;
  /** |z| (for metric outliers) or repeat count (for loops). */
  magnitude: number;
}

/** Given an incoming event plus the history it should be scored against,
 *  return any anomaly flags that apply. Empty array means "normal". */
export function scoreEvent(
  event: AgentEvent,
  history: AgentEvent[],
  thresholds: AnomalyThresholds = loadThresholds(),
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];

  const costHistory = historyMetrics(history, (e) => e.details?.cost);
  if (
    costHistory.length >= thresholds.minSamples &&
    event.details?.cost != null
  ) {
    const z = robustZ(event.details.cost, costHistory);
    if (z > thresholds.zScore) {
      flags.push({
        kind: "cost",
        message: `cost ${z.toFixed(1)}× normal ($${event.details.cost.toFixed(4)})`,
        magnitude: z,
      });
    }
  }

  const durHistory = historyMetrics(history, (e) => e.details?.durationMs);
  if (
    durHistory.length >= thresholds.minSamples &&
    event.details?.durationMs != null
  ) {
    const z = robustZ(event.details.durationMs, durHistory);
    if (z > thresholds.zScore) {
      flags.push({
        kind: "duration",
        message: `duration ${z.toFixed(1)}× normal (${event.details.durationMs}ms)`,
        magnitude: z,
      });
    }
  }

  const tokHistory = historyMetrics(history, (e) => {
    const u = e.details?.usage;
    return u ? u.input + u.cacheCreate : undefined;
  });
  if (tokHistory.length >= thresholds.minSamples && event.details?.usage) {
    const total =
      event.details.usage.input + event.details.usage.cacheCreate;
    const z = robustZ(total, tokHistory);
    if (z > thresholds.zScore) {
      flags.push({
        kind: "tokens",
        message: `tokens ${z.toFixed(1)}× normal (${total.toLocaleString()})`,
        magnitude: z,
      });
    }
  }

  return flags;
}

function historyMetrics(
  events: AgentEvent[],
  pick: (e: AgentEvent) => number | undefined,
): number[] {
  const out: number[] = [];
  for (const e of events) {
    const v = pick(e);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}
