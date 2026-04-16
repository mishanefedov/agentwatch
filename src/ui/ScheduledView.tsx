import { Box, Text } from "ink";
import type { AgentEvent } from "../schema.js";
import {
  humanizeMs,
  readCronJobs,
  type CronJob,
} from "../util/openclaw-cron.js";
import {
  readAllHeartbeats,
  type HeartbeatTask,
} from "../util/openclaw-heartbeat.js";
import { formatUSD } from "../util/cost.js";

/**
 * One row per defined OpenClaw cron job + one row per HEARTBEAT.md
 * task. Aggregates last-fired / runs-7d / cost-7d from any event in the
 * buffer whose `details.scheduled` matches.
 */

interface Props {
  events: AgentEvent[];
  selectedIdx: number;
  viewportRows: number;
}

export interface ScheduledRow {
  /** Stable id for navigation. For cron, the jobId; for heartbeat,
   *  workspace + task index. */
  id: string;
  kind: "cron" | "heartbeat";
  label: string;
  schedule: string;
  /** Agent the job/heartbeat is tied to (`main`, `content`, …). */
  agentId?: string;
  /** Most recent fire we've seen in the event buffer (ms). Undefined
   *  when no run has been observed yet. */
  lastFiredMs?: number;
  /** Runs we've seen in the last 7 days. */
  runs7d: number;
  /** Cumulative cost over those runs. */
  cost7d: number;
  /** Computed status. */
  status: "ok" | "overdue" | "no-data" | "disabled";
  /** When overdue, how many ms past expected. */
  overdueByMs?: number;
  /** Per-row navigation target — first sessionId we've seen for this
   *  scheduled task, so Enter can scope into the latest run. */
  latestSessionId?: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;
const OVERDUE_FACTOR = 1.5;

export function ScheduledView({ events, selectedIdx, viewportRows }: Props) {
  const rows = buildRows(events);
  const height = Math.max(3, viewportRows - 4);
  const first = Math.max(0, Math.min(rows.length - height, selectedIdx - 2));
  const visible = rows.slice(first, first + height);

  const totalCost = rows.reduce((s, r) => s + r.cost7d, 0);
  const totalRuns = rows.reduce((s, r) => s + r.runs7d, 0);
  const overdue = rows.filter((r) => r.status === "overdue").length;

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color="cyan">Scheduled tasks (cron + heartbeat)</Text>
      <Text dimColor>
        {rows.length} task{rows.length === 1 ? "" : "s"} · {totalRuns} runs / 7d · {formatUSD(totalCost)} / 7d
        {overdue > 0 ? `  · ⚠ ${overdue} overdue` : ""}
      </Text>
      <Text dimColor>[↑↓] navigate  [enter] open latest run  [S/esc] close</Text>
      <Box marginTop={1} flexDirection="column">
        {rows.length === 0 ? (
          <Text dimColor>
            (no scheduled tasks defined — add one with `openclaw cron add` or
            populate ~/.openclaw/workspace-*/HEARTBEAT.md)
          </Text>
        ) : (
          <>
            <Header />
            {visible.map((r, i) => (
              <Row
                key={r.id}
                row={r}
                selected={first + i === selectedIdx}
              />
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}

function Header() {
  return (
    <Text bold dimColor>
      {pad("kind", 5)}{pad("name", 24)}{pad("schedule", 14)}{pad("agent", 10)}{pad("last", 12)}{pad("runs7d", 8)}{pad("cost7d", 10)}status
    </Text>
  );
}

function Row({ row, selected }: { row: ScheduledRow; selected: boolean }) {
  const last = row.lastFiredMs ? agoFromNow(row.lastFiredMs) : "never";
  const status = renderStatus(row);
  return (
    <Text wrap="truncate" inverse={selected}>
      <Text color={row.kind === "cron" ? "magenta" : "yellow"}>
        {pad(row.kind === "cron" ? "cron" : "♥hb", 5)}
      </Text>
      <Text bold>{pad(row.label, 24)}</Text>
      <Text dimColor>{pad(row.schedule, 14)}</Text>
      <Text dimColor>{pad(row.agentId ?? "?", 10)}</Text>
      <Text dimColor>{pad(last, 12)}</Text>
      <Text>{pad(String(row.runs7d), 8)}</Text>
      <Text dimColor>{pad(row.cost7d > 0 ? formatUSD(row.cost7d) : "—", 10)}</Text>
      {status}
    </Text>
  );
}

function renderStatus(row: ScheduledRow) {
  if (row.status === "disabled") {
    return <Text dimColor>disabled</Text>;
  }
  if (row.status === "overdue" && row.overdueByMs != null) {
    return (
      <Text color="red">⚠ overdue {humanizeMs(row.overdueByMs)}</Text>
    );
  }
  if (row.status === "no-data") {
    return <Text dimColor>(awaiting first run)</Text>;
  }
  return <Text color="green">✓ on schedule</Text>;
}

function buildRows(events: AgentEvent[]): ScheduledRow[] {
  const cronJobs = readCronJobs();
  const heartbeats = readAllHeartbeats();
  const aggregates = aggregateEvents(events);
  const rows: ScheduledRow[] = [];

  for (const job of cronJobs) {
    const agg = aggregates.cron.get(job.id);
    rows.push(rowFromCron(job, agg));
  }
  let hbIdx = 0;
  for (const status of heartbeats) {
    for (const task of status.tasks) {
      const agg = aggregates.heartbeatByAgent.get(status.workspace);
      rows.push(rowFromHeartbeat(task, agg, status.workspace, hbIdx++));
    }
  }
  // Sort overdue first, then by recency.
  rows.sort((a, b) => {
    if ((a.status === "overdue") !== (b.status === "overdue")) {
      return a.status === "overdue" ? -1 : 1;
    }
    return (b.lastFiredMs ?? 0) - (a.lastFiredMs ?? 0);
  });
  return rows;
}

interface Aggregate {
  lastFiredMs?: number;
  runs7d: number;
  cost7d: number;
  latestSessionId?: string;
}

function aggregateEvents(events: AgentEvent[]): {
  cron: Map<string, Aggregate>;
  heartbeatByAgent: Map<string, Aggregate>;
} {
  const cron = new Map<string, Aggregate>();
  const heartbeatByAgent = new Map<string, Aggregate>();
  const now = Date.now();
  for (const e of events) {
    const sched = e.details?.scheduled;
    if (!sched) continue;
    const ts = new Date(e.ts).getTime();
    const within7d = now - ts <= SEVEN_DAYS_MS;
    const cost = e.details?.cost ?? 0;
    if (sched.kind === "cron" && sched.jobId) {
      const a = cron.get(sched.jobId) ?? bucket();
      bumpAggregate(a, ts, within7d, cost, e.sessionId);
      cron.set(sched.jobId, a);
    } else if (sched.kind === "heartbeat") {
      const key = sched.agentId ?? "main";
      const a = heartbeatByAgent.get(key) ?? bucket();
      bumpAggregate(a, ts, within7d, cost, e.sessionId);
      heartbeatByAgent.set(key, a);
    }
  }
  return { cron, heartbeatByAgent };
}

function bucket(): Aggregate {
  return { runs7d: 0, cost7d: 0 };
}

function bumpAggregate(
  a: Aggregate,
  ts: number,
  within7d: boolean,
  cost: number,
  sessionId: string | undefined,
): void {
  if (!a.lastFiredMs || ts > a.lastFiredMs) {
    a.lastFiredMs = ts;
    if (sessionId) a.latestSessionId = sessionId;
  }
  if (within7d) {
    a.runs7d += 1;
    a.cost7d += cost;
  }
}

function rowFromCron(job: CronJob, agg: Aggregate | undefined): ScheduledRow {
  const status = computeCronStatus(job, agg);
  return {
    id: `cron:${job.id}`,
    kind: "cron",
    label: job.name,
    schedule: job.schedule,
    agentId: job.agentId,
    lastFiredMs: agg?.lastFiredMs,
    runs7d: agg?.runs7d ?? 0,
    cost7d: agg?.cost7d ?? 0,
    status: status.status,
    overdueByMs: status.overdueByMs,
    latestSessionId: agg?.latestSessionId,
  };
}

function rowFromHeartbeat(
  task: HeartbeatTask,
  agg: Aggregate | undefined,
  workspace: string,
  idx: number,
): ScheduledRow {
  return {
    id: `hb:${workspace}:${idx}`,
    kind: "heartbeat",
    label: task.text,
    // Heartbeat schedule is configured per-agent in gateway config —
    // we surface "per agent" rather than guess the interval.
    schedule: "per agent",
    agentId: workspace.replace(/^workspace-/, ""),
    lastFiredMs: agg?.lastFiredMs,
    runs7d: agg?.runs7d ?? 0,
    cost7d: agg?.cost7d ?? 0,
    // Heartbeats don't have a defined cron expression we can compare
    // against, so we don't compute overdue here. Skip-reason events
    // (a follow-up) will surface that signal directly.
    status: agg ? "ok" : "no-data",
    latestSessionId: agg?.latestSessionId,
  };
}

function computeCronStatus(
  job: CronJob,
  agg: Aggregate | undefined,
): { status: ScheduledRow["status"]; overdueByMs?: number } {
  if (!job.enabled) return { status: "disabled" };
  if (!agg?.lastFiredMs) return { status: "no-data" };
  if (!job.intervalMs) return { status: "ok" };
  const elapsed = Date.now() - agg.lastFiredMs;
  if (elapsed > job.intervalMs * OVERDUE_FACTOR) {
    return { status: "overdue", overdueByMs: elapsed - job.intervalMs };
  }
  return { status: "ok" };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}

function agoFromNow(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Total row count so the App reducer can clamp navigation. */
export function scheduledRowCount(events: AgentEvent[]): number {
  return buildRows(events).length;
}

/** Selected row's latest sessionId — for Enter to scope into the most
 *  recent run of that scheduled task. */
export function scheduledSelectedSessionId(
  events: AgentEvent[],
  selectedIdx: number,
): string | null {
  const rows = buildRows(events);
  return rows[selectedIdx]?.latestSessionId ?? null;
}
