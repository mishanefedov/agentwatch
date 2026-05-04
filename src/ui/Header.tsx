import { Box, Text } from "ink";
import type { AgentName } from "../schema.js";
import type { BudgetStatus } from "../util/budgets.js";
import type { AnomalyFlag, SessionAnomalySummary } from "../util/anomaly.js";
import { formatUSD } from "../util/cost.js";
import { VERSION } from "../util/version.js";

interface Props {
  workspace: string;
  eventCount: number;
  filter: AgentName | null;
  paused: boolean;
  budget?: BudgetStatus;
  anomalies?: Map<string, AnomalyFlag[]>;
  sessionAnomalies?: SessionAnomalySummary[];
  webUrl?: string;
  /** AUR-276: dev-only candidate-pair count surfaced when the operator
   *  sets `AGENTWATCH_DEBUG_LINKS=1`. Always undefined in normal use. */
  linkCandidateCount?: number;
}

export type { Props as HeaderProps };

export function Header({
  workspace,
  eventCount,
  filter,
  paused,
  budget,
  anomalies,
  sessionAnomalies,
  webUrl,
  linkCandidateCount,
}: Props) {
  const breached = budget?.breachedSession || budget?.dayBreach;
  const anomalyMessages = summarizeAnomalies(anomalies);
  const sessionRows = (sessionAnomalies ?? []).slice(0, 2);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text bold color="cyan">agentwatch </Text>
          <Text dimColor>v{VERSION}</Text>
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
          {webUrl && (
            <>
              <Text dimColor>  web: </Text>
              <Text color="cyan">{webUrl}</Text>
              <Text dimColor> [w]</Text>
            </>
          )}
          {linkCandidateCount != null && (
            <>
              <Text dimColor>  links: </Text>
              <Text>{linkCandidateCount}</Text>
            </>
          )}
        </Text>
      </Box>
      {breached && budget && budget.sessionCost > 0 && (
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
      {sessionRows.map((s) => {
        const total =
          s.counts.cost + s.counts.duration + s.counts.tokens + s.counts["stuck-loop"];
        return (
          <Text key={s.sessionId} color="red">
            ⚠ session {s.sessionId.slice(0, 8)} · {total} flag
            {total === 1 ? "" : "s"} · {s.headline}
          </Text>
        );
      })}
      {sessionRows.length === 0 &&
        anomalyMessages.map((msg) => (
          <Text key={msg} color="red">
            ⚠ anomaly: <Text bold>{msg}</Text>
          </Text>
        ))}
      {(sessionRows.length > 0 || anomalyMessages.length > 0) && (
        <Text dimColor>[D] dismiss banner until the next anomaly</Text>
      )}
    </Box>
  );
}

function summarizeAnomalies(
  map?: Map<string, AnomalyFlag[]>,
): string[] {
  if (!map || map.size === 0) return [];
  const seen = new Set<string>();
  const msgs: string[] = [];
  for (const flags of map.values()) {
    for (const f of flags) {
      const key = `${f.kind}:${f.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      msgs.push(f.message);
      if (msgs.length >= 3) return msgs;
    }
  }
  return msgs;
}
