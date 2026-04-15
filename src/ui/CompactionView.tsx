import { Box, Text } from "ink";
import {
  buildCompactionSeries,
  renderCompactionBar,
  type CompactionSeries,
} from "../util/compaction.js";
import type { AgentEvent } from "../schema.js";

interface Props {
  events: AgentEvent[];
  sessionId: string;
  /** Index of the selected point within series.points; used to drill
   *  into a specific compaction marker or turn. */
  selectedIdx: number;
  viewportCols: number;
}

export function CompactionView({
  events,
  sessionId,
  selectedIdx,
  viewportCols,
}: Props) {
  const series = buildCompactionSeries(events, sessionId);
  const barWidth = Math.min(series.points.length, Math.max(10, viewportCols - 10));
  const bar = renderCompactionBar(series, barWidth);
  const tail = series.points.slice(-barWidth);
  const selectedAbs = Math.max(
    0,
    Math.min(series.points.length - 1, selectedIdx),
  );
  const selectedInTail = tail.indexOf(series.points[selectedAbs]!);

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text>
        <Text bold color="cyan">Context compaction — </Text>
        <Text>{sessionId.slice(0, 12)}</Text>
        <Text dimColor>{"  "}window {series.contextWindow.toLocaleString()}</Text>
        <Text dimColor>{"  "}turns {series.points.filter((p) => p.kind === "turn").length}</Text>
        <Text dimColor>{"  "}compactions {series.compactionCount}</Text>
        <Text dimColor>{"  "}max fill {(series.maxFill * 100).toFixed(0)}%</Text>
      </Text>
      <Text dimColor>[←→] select point  [esc] back  [C] close</Text>
      <Box marginTop={1}>
        <Text>
          <Text dimColor>0% </Text>
          {bar.split("").map((ch, i) => (
            <Text
              key={i}
              color={ch === "⋈" ? "red" : fillColor(tail[i]?.fillBefore ?? 0)}
              inverse={i === selectedInTail}
            >
              {ch}
            </Text>
          ))}
          <Text dimColor> 100%</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <SelectedPointDetail series={series} idx={selectedAbs} />
      </Box>
    </Box>
  );
}

function SelectedPointDetail({
  series,
  idx,
}: {
  series: CompactionSeries;
  idx: number;
}) {
  const point = series.points[idx];
  if (!point) {
    return <Text dimColor>(no points)</Text>;
  }
  if (point.kind === "compaction") {
    const before = point.tokensBefore ?? 0;
    const after = point.tokensAfter ?? 0;
    const dropped = before - after;
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="red" bold>⋈ compaction at {point.ts.slice(11, 19)}</Text>
        </Text>
        <Text dimColor>
          before: {before.toLocaleString()} tokens ({(point.fillBefore * 100).toFixed(0)}% full)
        </Text>
        <Text dimColor>
          after:  {after.toLocaleString()} tokens
        </Text>
        <Text>
          <Text color="green">dropped {dropped.toLocaleString()} tokens</Text>
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>turn {point.label}</Text>
        <Text dimColor>  {point.ts.slice(11, 19)}</Text>
      </Text>
      <Text dimColor>
        {point.tokensBefore?.toLocaleString() ?? "?"} tokens ({(point.fillBefore * 100).toFixed(0)}% full)
      </Text>
    </Box>
  );
}

function fillColor(f: number): string {
  if (f >= 0.9) return "red";
  if (f >= 0.75) return "yellow";
  if (f >= 0.4) return "green";
  return "cyan";
}

export function compactionPointCount(
  events: AgentEvent[],
  sessionId: string,
): number {
  return buildCompactionSeries(events, sessionId).points.length;
}
