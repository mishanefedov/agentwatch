import { Box, Text } from "ink";
import type { AgentName } from "../schema.js";
import type { BudgetStatus } from "../util/budgets.js";
import { formatUSD } from "../util/cost.js";

interface Props {
  workspace: string;
  eventCount: number;
  filter: AgentName | null;
  paused: boolean;
  budget?: BudgetStatus;
}

export type { Props as HeaderProps };

export function Header({ workspace, eventCount, filter, paused, budget }: Props) {
  const breached = budget?.breachedSession || budget?.dayBreach;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
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
      {breached && budget && (
        <Box>
          <Text color="red" bold>
            ⚠ BUDGET BREACH
          </Text>
          {budget.breachedSession && budget.perSessionUsd != null && (
            <Text color="red">
              {"  session "}
              {budget.breachedSession.slice(0, 8)}
              {" "}
              {formatUSD(budget.sessionCost)}
              {" > cap "}
              {formatUSD(budget.perSessionUsd)}
            </Text>
          )}
          {budget.dayBreach && budget.perDayUsd != null && (
            <Text color="red">
              {"  today "}
              {formatUSD(budget.dayCost)}
              {" > cap "}
              {formatUSD(budget.perDayUsd)}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
