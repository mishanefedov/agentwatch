import { Box, Text } from "ink";
import type { AgentEvent, AgentName } from "../schema.js";

interface Props {
  events: AgentEvent[];
  selectedIdx?: number | null;
  childCountByAgentId?: Map<string, number>;
}

export function Timeline({
  events,
  selectedIdx,
  childCountByAgentId,
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
      {visible.map((e, i) => (
        <EventRow
          key={e.id}
          event={e}
          selected={windowStart + i === selectedIdx}
          childCount={
            e.details?.subAgentId
              ? (childCountByAgentId?.get(e.details.subAgentId) ?? 0)
              : 0
          }
        />
      ))}
    </Box>
  );
}

function EventRow({
  event,
  selected,
  childCount,
}: {
  event: AgentEvent;
  selected: boolean;
  childCount: number;
}) {
  const time = event.ts.slice(11, 19);
  const baseLine = event.summary ?? event.path ?? event.cmd ?? event.tool ?? event.type;
  const duration = event.details?.durationMs != null
    ? ` · ${formatMs(event.details.durationMs)}`
    : "";
  const err = event.details?.toolError ? " · ERR" : "";
  const marker = childCount > 0 ? ` ▸ ${childCount} child events` : "";
  return (
    <Box>
      <Text wrap="truncate" inverse={selected}>
        <Text dimColor>{time} </Text>
        <Text color={agentColor(event.agent)}>{pad(event.agent, 10)} </Text>
        <Text color={riskColor(event.riskScore)}>{pad(event.type, 13)} </Text>
        <Text>{baseLine}</Text>
        {duration && <Text dimColor>{duration}</Text>}
        {err && <Text color="red">{err}</Text>}
        {childCount > 0 && <Text color="yellow">{marker}</Text>}
      </Text>
    </Box>
  );
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

