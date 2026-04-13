import { Box, Text } from "ink";
import type { AgentEvent } from "../schema.js";
import type { DetectedAgent } from "../adapters/detect.js";

interface Props {
  agents: DetectedAgent[];
  events: AgentEvent[];
}

export function AgentPanel({ agents, events }: Props) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>Agents</Text>
      {agents.map((a) => {
        const count = events.filter((e) => e.agent === a.name).length;
        const last = events.find((e) => e.agent === a.name);
        return (
          <Box key={a.name} flexDirection="column" marginTop={1}>
            <Text color={a.present ? "green" : "gray"}>
              {a.present ? "●" : "○"} {a.label}
            </Text>
            <Text dimColor>  {a.present ? "installed" : "not detected"}</Text>
            {a.present && (
              <Text dimColor>
                {"  "}events: {count}
                {last ? `, last ${last.ts.slice(11, 19)}` : ""}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
