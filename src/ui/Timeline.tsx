import { Box, Text } from "ink";
import type { AgentEvent, AgentName } from "../schema.js";

interface Props {
  events: AgentEvent[];
}

export function Timeline({ events }: Props) {
  if (events.length === 0) {
    return (
      <Box>
        <Text dimColor>
          waiting for activity… use Claude Code or edit a file in your workspace
        </Text>
      </Box>
    );
  }

  const visible = events.slice(0, 40);

  return (
    <Box flexDirection="column">
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
      <Text dimColor>{time} </Text>
      <Text color={agentColor(event.agent)}>{pad(event.agent, 12)} </Text>
      <Text color={riskColor(event.riskScore)}>{pad(event.type, 12)} </Text>
      <Text>{truncate(line, 100)}</Text>
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

