import { Box, Text } from "ink";
import type { SessionRow } from "../util/project-index.js";
import { agoFromNow, dateBucket, isStale } from "../util/project-index.js";
import { formatUSD } from "../util/cost.js";
import type { AgentName } from "../schema.js";

interface Props {
  project: string;
  sessions: SessionRow[];
  selectedIdx: number;
  viewportRows: number;
  scrollOffset: number;
}

type Line =
  | { kind: "bucket"; label: string }
  | { kind: "session"; row: SessionRow; absIdx: number };

export function SessionsView({
  project,
  sessions,
  selectedIdx,
  viewportRows,
  scrollOffset,
}: Props) {
  const lines = buildLines(sessions);
  const height = Math.max(3, viewportRows);
  const maxScroll = Math.max(0, lines.length - height);
  const offset = Math.min(scrollOffset, maxScroll);
  const visible = lines.slice(offset, offset + height);

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text>
        <Text bold color="cyan">
          Sessions —{" "}
        </Text>
        <Text bold>{project}</Text>
        <Text dimColor>
          {"   "}
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </Text>
      </Text>
      <Text dimColor>
        [↑↓] select  [enter] open session  [esc] back to projects  [q] quit
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.length === 0 ? (
          <Text dimColor>(no sessions found for this project)</Text>
        ) : (
          visible.map((l, i) => <LineView key={i} line={l} selectedIdx={selectedIdx} />)
        )}
      </Box>
      {lines.length > height && (
        <Box marginTop={1}>
          <Text dimColor>
            {offset + 1}–{offset + visible.length} of {lines.length}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function LineView({ line, selectedIdx }: { line: Line; selectedIdx: number }) {
  if (line.kind === "bucket") {
    return (
      <Box marginTop={1}>
        <Text bold dimColor>
          {bucketLabel(line.label)}
        </Text>
      </Box>
    );
  }
  const r = line.row;
  const selected = line.absIdx === selectedIdx;
  const agentTag = tagFor(r.agent, r.subAgent);
  const stale = isStale(r.lastTs);
  return (
    <Box>
      <Text wrap="truncate" inverse={selected} dimColor={stale}>
        <Text color="yellow">{selected ? "▶ " : "  "}</Text>
        <Text color={stale ? undefined : colorForAgent(r.agent)}>{pad(agentTag, 22)}</Text>
        <Text> {truncate(r.firstPrompt || "(no user prompt yet)", 56)}</Text>
        <Text dimColor> · {r.events}ev · {agoFromNow(r.lastTs)}</Text>
        {r.cost > 0 && (
          <Text dimColor>
            {" · "}
            <Text color={stale ? undefined : "yellow"}>{formatUSD(r.cost)}</Text>
          </Text>
        )}
        {r.hasError && <Text color="red"> · ERR</Text>}
        {stale && <Text dimColor> · ⊘ stale</Text>}
      </Text>
    </Box>
  );
}

function buildLines(sessions: SessionRow[]): Line[] {
  const lines: Line[] = [];
  let currentBucket = "";
  let idx = 0;
  for (const row of sessions) {
    const bucket = dateBucket(row.lastTs);
    if (bucket !== currentBucket) {
      currentBucket = bucket;
      lines.push({ kind: "bucket", label: bucket });
    }
    lines.push({ kind: "session", row, absIdx: idx++ });
  }
  return lines;
}

function bucketLabel(b: string): string {
  if (b === "today") return "TODAY";
  if (b === "yesterday") return "YESTERDAY";
  if (b === "7d") return "LAST 7 DAYS";
  return "OLDER";
}

function tagFor(agent: AgentName, sub?: string): string {
  if (sub) return `[${agent}:${sub}]`;
  return `[${agent}]`;
}

function colorForAgent(a: AgentName): string {
  switch (a) {
    case "claude-code": return "cyan";
    case "openclaw": return "yellow";
    case "cursor": return "magenta";
    case "codex": return "green";
    case "gemini": return "blue";
    default: return "white";
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** Total renderable lines so callers can compute scroll bounds. */
export function sessionLineCount(sessions: SessionRow[]): number {
  return buildLines(sessions).length;
}
