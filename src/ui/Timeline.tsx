import { Box, Text } from "ink";
import type { AgentEvent, AgentName } from "../schema.js";

interface Props {
  events: AgentEvent[];
  selectedIdx?: number | null;
  childCountByAgentId?: Map<string, number>;
  expandedIds?: Set<string>;
}

const MAX_EXPAND_LINES = 10;

export function Timeline({
  events,
  selectedIdx,
  childCountByAgentId,
  expandedIds,
}: Props) {
  const header = (
    <Box>
      <Text bold dimColor>
        {"TIME     "}
        {pad("AGENT", 10)}
        {" "}
        {pad("TYPE", 13)}
        {" "}
        EVENT
      </Text>
    </Box>
  );

  if (events.length === 0) {
    return (
      <Box flexDirection="column">
        {header}
        <Box marginTop={1}>
          <Text dimColor>
            waiting for activity… use Claude Code or edit a file in your workspace
          </Text>
        </Box>
      </Box>
    );
  }

  // Keep the selected row in view if the user has navigated deep into history
  const windowStart =
    selectedIdx != null && selectedIdx > 30
      ? Math.max(0, selectedIdx - 15)
      : 0;
  const visible = events.slice(windowStart, windowStart + 40);

  return (
    <Box flexDirection="column">
      {header}
      {visible.map((e, i) => {
        const expanded = expandedIds?.has(e.id) === true;
        return (
          <Box flexDirection="column" key={e.id}>
            <EventRow
              event={e}
              selected={windowStart + i === selectedIdx}
              childCount={
                e.details?.subAgentId
                  ? (childCountByAgentId?.get(e.details.subAgentId) ?? 0)
                  : 0
              }
              expanded={expanded}
            />
            {expanded && <ExpansionBlock event={e} />}
          </Box>
        );
      })}
    </Box>
  );
}

function EventRow({
  event,
  selected,
  childCount,
  expanded,
}: {
  event: AgentEvent;
  selected: boolean;
  childCount: number;
  expanded: boolean;
}) {
  const time = event.ts.slice(11, 19);
  const baseLine = event.summary ?? event.path ?? event.cmd ?? event.tool ?? event.type;
  const duration = event.details?.durationMs != null
    ? ` · ${formatMs(event.details.durationMs)}`
    : "";
  const err = event.details?.toolError ? " · ERR" : "";
  const marker = childCount > 0 ? ` ▸ ${childCount} child events` : "";
  const arrow = hasExpandableContent(event)
    ? (expanded ? "▾ " : "▸ ")
    : "  ";
  return (
    <Box>
      <Text wrap="truncate" inverse={selected}>
        <Text dimColor>{time} </Text>
        <Text color={agentColor(event.agent)}>{pad(event.agent, 10)} </Text>
        <Text color={riskColor(event.riskScore)}>{pad(event.type, 13)} </Text>
        <Text dimColor>{arrow}</Text>
        <Text>{baseLine}</Text>
        {duration && <Text dimColor>{duration}</Text>}
        {err && <Text color="red">{err}</Text>}
        {childCount > 0 && <Text color="yellow">{marker}</Text>}
      </Text>
    </Box>
  );
}

function hasExpandableContent(e: AgentEvent): boolean {
  const d = e.details;
  if (!d) return false;
  return Boolean(d.toolResult || d.fullText || d.thinking || d.toolInput);
}

function ExpansionBlock({ event }: { event: AgentEvent }) {
  const lines = buildExpansionLines(event);
  if (lines.length === 0) return null;
  const truncated = lines.length > MAX_EXPAND_LINES;
  const visible = lines.slice(0, MAX_EXPAND_LINES);
  return (
    <Box flexDirection="column" paddingLeft={4}>
      {visible.map((line, i) => (
        <Text key={i} dimColor={line.dim} color={line.color}>
          {line.text || " "}
        </Text>
      ))}
      {truncated && (
        <Text dimColor>
          … {lines.length - MAX_EXPAND_LINES} more lines (press Enter for full view)
        </Text>
      )}
    </Box>
  );
}

interface ExpansionLine {
  text: string;
  dim?: boolean;
  color?: string;
}

function buildExpansionLines(event: AgentEvent): ExpansionLine[] {
  const d = event.details;
  if (!d) return [];
  const out: ExpansionLine[] = [];
  if (d.toolInput && !d.toolResult) {
    const pretty = JSON.stringify(d.toolInput, null, 2);
    for (const l of pretty.split("\n")) out.push({ text: l, dim: true });
  }
  if (d.toolResult) {
    const color = d.toolError ? "red" : undefined;
    for (const l of d.toolResult.split("\n")) out.push({ text: l, color });
  }
  if (!d.toolResult && !d.toolInput && d.fullText) {
    for (const l of d.fullText.split("\n")) out.push({ text: l });
  }
  return out;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function agentColor(a: AgentName): string {
  switch (a) {
    case "claude-code": return "cyan";
    case "codex": return "green";
    case "cursor": return "magenta";
    case "gemini": return "blue";
    case "openclaw": return "yellow";
    default: return "gray";
  }
}

function riskColor(r: number): string {
  if (r >= 8) return "red";
  if (r >= 5) return "yellow";
  if (r >= 3) return "white";
  return "gray";
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

