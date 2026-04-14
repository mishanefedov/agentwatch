import { Box, Text } from "ink";
import type { AgentEvent } from "../schema.js";
import type { DetectedAgent } from "../adapters/detect.js";
import { formatUSD } from "../util/cost.js";

interface Props {
  agents: DetectedAgent[];
  events: AgentEvent[];
}

export function AgentPanel({ agents, events }: Props) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>Agents</Text>
      {agents.map((a) => {
        const forAgent = events.filter((e) => e.agent === a.name);
        const count = forAgent.length;
        const last = forAgent[0];
        const cost = forAgent.reduce(
          (acc, e) => acc + (e.details?.cost ?? 0),
          0,
        );
        const dotColor = !a.present
          ? "gray"
          : a.instrumented
            ? "green"
            : "yellow";
        const statusLabel = !a.present
          ? "not detected"
          : a.instrumented
            ? "installed"
            : "detected (events TBD)";
        return (
          <Box key={a.name} flexDirection="column" marginTop={1}>
            <Text color={dotColor}>
              {a.present ? "●" : "○"} {a.label}
            </Text>
            <Text dimColor>  {statusLabel}</Text>
            {a.present && a.instrumented && (
              <>
                <Text dimColor>
                  {"  "}events: {count}
                  {last ? `, last ${last.ts.slice(11, 19)}` : ""}
                </Text>
                {cost > 0 && (
                  <Text dimColor>
                    {"  "}cost: <Text color="yellow">{formatUSD(cost)}</Text>
                  </Text>
                )}
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
