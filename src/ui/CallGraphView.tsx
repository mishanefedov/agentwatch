import { Box, Text } from "ink";
import type { AgentEvent, AgentName } from "../schema.js";
import {
  aggregateSubtree,
  buildCallGraph,
  flatten,
  type CallGraphNode,
} from "../util/call-graph.js";
import { formatUSD } from "../util/cost.js";

interface Props {
  events: AgentEvent[];
  rootSessionId: string;
  selectedIdx: number;
  viewportRows: number;
}

export function CallGraphView({
  events,
  rootSessionId,
  selectedIdx,
  viewportRows,
}: Props) {
  const tree = buildCallGraph(events, rootSessionId);
  if (!tree) {
    return (
      <Box flexDirection="column" borderStyle="double" paddingX={1}>
        <Text bold color="cyan">Call graph</Text>
        <Text dimColor>(no events found in this session yet)</Text>
      </Box>
    );
  }
  const agg = aggregateSubtree(tree);
  const rows = flatten(tree);
  const height = Math.max(3, viewportRows - 5);
  const first = Math.max(0, Math.min(rows.length - height, selectedIdx - 2));
  const visible = rows.slice(first, first + height);

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color="cyan">Call graph</Text>
      <Text dimColor>
        session {rootSessionId.slice(0, 12)} ·{" "}
        {agg.agents.size} agent{agg.agents.size === 1 ? "" : "s"} ·{" "}
        {agg.totalEvents} event{agg.totalEvents === 1 ? "" : "s"} · total{" "}
        {formatUSD(agg.totalCost)} · {(agg.totalInput + agg.totalOutput).toLocaleString()} tokens
      </Text>
      <Text dimColor>[↑↓] navigate  [enter] open node session  [g/esc] back</Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((row, i) => (
          <CallRow
            key={row.node.eventId}
            row={row}
            selected={first + i === selectedIdx}
            depth={row.depth}
            isLast={row.isLast}
          />
        ))}
      </Box>
    </Box>
  );
}

function CallRow({
  row,
  selected,
  depth,
  isLast,
}: {
  row: { depth: number; node: CallGraphNode; isLast: boolean };
  selected: boolean;
  depth: number;
  isLast: boolean;
}) {
  const node = row.node;
  // Build the indent prefix using box-drawing chars.
  // Top-level (depth 0) has no prefix; subsequent levels get
  //    "│   " for ancestors that have more siblings, "    " otherwise,
  //    capped by "├── " or "└── " for the current level.
  let prefix = "";
  for (let d = 0; d < depth - 1; d++) prefix += "│   ";
  if (depth > 0) prefix += isLast ? "└── " : "├── ";

  const labelColor = node.kind === "session" ? agentColor(node.agent) : "yellow";
  const label =
    node.kind === "session"
      ? `[${node.agent}] ${(node.sessionId ?? "").slice(0, 10)}`
      : `→ ${node.callee}: ${truncate(node.prompt ?? "(no prompt)", 50)}`;

  const metrics: string[] = [];
  if (node.cost > 0) metrics.push(formatUSD(node.cost));
  const tokens = node.inputTokens + node.outputTokens;
  if (tokens > 0) metrics.push(`${tokens.toLocaleString()}t`);
  if (node.kind === "session" && node.events > 0) {
    metrics.push(`${node.events}ev`);
  }

  return (
    <Box>
      <Text wrap="truncate" inverse={selected}>
        <Text dimColor>{prefix}</Text>
        <Text color={labelColor}>{label}</Text>
        {metrics.length > 0 && <Text dimColor>  · {metrics.join(" · ")}</Text>}
      </Text>
    </Box>
  );
}

function agentColor(agent: AgentName | undefined): string {
  switch (agent) {
    case "claude-code": return "cyan";
    case "codex": return "green";
    case "gemini": return "blue";
    case "cursor": return "magenta";
    case "openclaw": return "yellow";
    default: return "white";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** Total node count so the App reducer can clamp the selection index. */
export function callGraphRowCount(
  events: AgentEvent[],
  rootSessionId: string,
): number {
  const tree = buildCallGraph(events, rootSessionId);
  if (!tree) return 0;
  return flatten(tree).length;
}

/** The session id at the given selected index, for Enter to drill in. */
export function callGraphSelectedSession(
  events: AgentEvent[],
  rootSessionId: string,
  selectedIdx: number,
): string | null {
  const tree = buildCallGraph(events, rootSessionId);
  if (!tree) return null;
  const flat = flatten(tree);
  const node = flat[selectedIdx]?.node;
  return node?.sessionId ?? null;
}
