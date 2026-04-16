import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Parser for OpenClaw's cron job store at `~/.openclaw/cron/jobs.json`.
 *
 * Real shape verified by running `openclaw cron add --json`:
 * {
 *   id, agentId, name, enabled, createdAtMs, updatedAtMs,
 *   schedule: { kind: "every"|"cron"|"at", everyMs?, expr?, atMs?, anchorMs },
 *   sessionTarget: "isolated"|"main",
 *   wakeMode: "now"|"next-heartbeat",
 *   payload: { kind: "agentTurn"|"systemEvent", message? },
 *   delivery: { mode, channel },
 *   state: { nextRunAtMs }
 * }
 */

export interface CronJob {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: string;
  scheduleKind: "every" | "cron" | "at" | "unknown";
  intervalMs?: number;
  nextRunAtMs?: number;
  sessionTarget?: string;
  wakeMode?: string;
  message?: string;
  deliveryChannel?: string;
}

export const CRON_JOBS_PATH = path.join(os.homedir(), ".openclaw", "cron", "jobs.json");

/** Read + parse the cron jobs store. Returns [] when the file doesn't
 *  exist (no cron jobs defined yet) or fails to parse. */
export function readCronJobs(file: string = CRON_JOBS_PATH): CronJob[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }
  const jobs = (doc as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs
    .map(parseJob)
    .filter((j): j is CronJob => j !== null);
}

function parseJob(j: unknown): CronJob | null {
  if (!j || typeof j !== "object") return null;
  const r = j as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const schedule = (r.schedule ?? {}) as Record<string, unknown>;
  const kind = scheduleKind(schedule);
  const payload = (r.payload ?? {}) as Record<string, unknown>;
  const delivery = (r.delivery ?? {}) as Record<string, unknown>;
  const state = (r.state ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    agentId: typeof r.agentId === "string" ? r.agentId : "main",
    name: r.name,
    enabled: r.enabled !== false,
    schedule: scheduleString(schedule, kind),
    scheduleKind: kind,
    intervalMs: typeof schedule.everyMs === "number" ? schedule.everyMs : undefined,
    nextRunAtMs: typeof state.nextRunAtMs === "number" ? state.nextRunAtMs : undefined,
    sessionTarget:
      typeof r.sessionTarget === "string" ? r.sessionTarget : undefined,
    wakeMode: typeof r.wakeMode === "string" ? r.wakeMode : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
    deliveryChannel:
      typeof delivery.channel === "string" ? delivery.channel : undefined,
  };
}

function scheduleKind(s: Record<string, unknown>): CronJob["scheduleKind"] {
  if (s.kind === "every" || s.kind === "cron" || s.kind === "at") return s.kind;
  return "unknown";
}

function scheduleString(
  s: Record<string, unknown>,
  kind: CronJob["scheduleKind"],
): string {
  if (kind === "every" && typeof s.everyMs === "number") {
    return `every ${humanizeMs(s.everyMs)}`;
  }
  if (kind === "cron" && typeof s.expr === "string") return s.expr;
  if (kind === "at" && typeof s.atMs === "number") {
    return `at ${new Date(s.atMs).toISOString()}`;
  }
  return "?";
}

export function humanizeMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

/**
 * Inspect an OpenClaw sessions.json entry and decide whether it
 * represents a scheduled run.
 *
 * Live data shows two markers:
 *  - sessionKey containing `:cron:` →  cron-spawned session
 *  - origin.provider === "heartbeat" → heartbeat-triggered session
 *
 * Returns the metadata to attach to events from this session, or null
 * if it's an interactive/manual session.
 */
export interface ScheduledMarker {
  kind: "cron" | "heartbeat";
  jobId?: string;
  agentId?: string;
  runId?: string;
}

export function classifySessionKey(
  sessionKey: string,
  entry: Record<string, unknown> | undefined,
): ScheduledMarker | null {
  // Heartbeat: origin.provider === "heartbeat"
  const origin = (entry?.origin ?? {}) as Record<string, unknown>;
  if (origin.provider === "heartbeat") {
    return {
      kind: "heartbeat",
      agentId: agentIdFromKey(sessionKey),
    };
  }
  // Cron: sessionKey shape `agent:<agentId>:cron:<jobId>` or
  // `agent:<agentId>:cron:<jobId>:run:<runId>`. Job/run ids are usually
  // UUIDs but we accept any non-colon token to be defensive against
  // future runtime changes.
  const m = sessionKey.match(
    /^agent:([^:]+):cron:([^:]+)(?::run:([^:]+))?$/,
  );
  if (m) {
    return {
      kind: "cron",
      agentId: m[1],
      jobId: m[2],
      runId: m[3] ?? undefined,
    };
  }
  return null;
}

function agentIdFromKey(sessionKey: string): string | undefined {
  const m = sessionKey.match(/^agent:([^:]+):/);
  return m?.[1];
}
