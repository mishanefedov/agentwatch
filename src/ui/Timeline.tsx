import { Box, Text } from "ink";
import type { AgentEvent, AgentName } from "../schema.js";

interface Props {
  events: AgentEvent[];
}

export function Timeline({ events }: Props) {
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

  const visible = events.slice(0, 40);

  return (
    <Box flexDirection="column">
      {header}
      {visible.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </Box>
  );
}

function EventRow({ event }: { event: AgentEvent }) {
  const time = event.ts.slice(11, 19);
  const line = event.summary ?? event.path ?? event.cmd ?? event.tool ?? event.type;
  return (
    <Box>
      <Text wrap="truncate">
        <Text dimColor>{time} </Text>
        <Text color={agentColor(event.agent)}>{pad(event.agent, 10)} </Text>
        <Text color={riskColor(event.riskScore)}>{pad(event.type, 13)} </Text>
        <Text>{line}</Text>
      </Text>
    </Box>
  );
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

