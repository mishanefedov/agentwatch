import { Box, Text } from "ink";
import type { AgentName } from "../schema.js";

interface Props {
  workspace: string;
  eventCount: number;
  filter: AgentName | null;
  paused: boolean;
}

export function Header({ workspace, eventCount, filter, paused }: Props) {
  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
      <Text>
        <Text bold color="cyan">agentwatch </Text>
        <Text dimColor>v0.0.1</Text>
      </Text>
      <Text>
        <Text dimColor>workspace: </Text>
        <Text>{workspace}</Text>
        <Text dimColor>  events: </Text>
        <Text>{eventCount}</Text>
        {filter && (
          <>
            <Text dimColor>  filter: </Text>
            <Text color="yellow">{filter}</Text>
          </>
        )}
        {paused && (
          <>
            <Text dimColor>  </Text>
            <Text color="red">[PAUSED]</Text>
          </>
        )}
      </Text>
    </Box>
  );
}
