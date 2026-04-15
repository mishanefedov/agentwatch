import { Box, Text } from "ink";
import type { TokenBreakdown } from "../util/token-attribution.js";
import { totalTokens } from "../util/token-attribution.js";
import { formatUSD } from "../util/cost.js";

interface Props {
  breakdown: TokenBreakdown;
  sessionId: string;
}

type Row = {
  label: string;
  tokens: number;
  color: string;
  /** `true` for counts measured precisely from the usage object; `false`
   *  when we approximate from character length. */
  precise: boolean;
};

export function TokensView({ breakdown, sessionId }: Props) {
  const total = totalTokens(breakdown);
  const rows: Row[] = [
    { label: "input (fresh)", tokens: breakdown.input, color: "cyan", precise: true },
    { label: "cache read", tokens: breakdown.cacheRead, color: "green", precise: true },
    { label: "cache create", tokens: breakdown.cacheCreate, color: "yellow", precise: true },
    { label: "output", tokens: breakdown.output, color: "magenta", precise: true },
    { label: "thinking (~)", tokens: breakdown.thinking, color: "blue", precise: false },
    { label: "tool I/O (~)", tokens: breakdown.toolIO, color: "white", precise: false },
    { label: "user text (~)", tokens: breakdown.user, color: "gray", precise: false },
  ];

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color="cyan">
        Token attribution
      </Text>
      <Text dimColor>
        session {sessionId.slice(0, 12)} · {breakdown.turns} assistant turn
        {breakdown.turns === 1 ? "" : "s"} · total {total.toLocaleString()}{" "}
        tokens · {formatUSD(breakdown.cost)}
      </Text>
      <Text dimColor>[t] close  [esc] back</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((r) => (
          <Row key={r.label} row={r} total={total} />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          (~) fields are approximated from content length (chars ÷ 4), not
          tokenizer output. Input/cache/output come from the model's usage
          record and are exact.
        </Text>
      </Box>
    </Box>
  );
}

function Row({ row, total }: { row: Row; total: number }) {
  const barWidth = 30;
  const pct = total > 0 ? row.tokens / total : 0;
  const filled = Math.round(pct * barWidth);
  const bar = "█".repeat(filled) + "·".repeat(Math.max(0, barWidth - filled));
  const pctLabel = `${(pct * 100).toFixed(1).padStart(5)}%`;
  return (
    <Box>
      <Text>
        <Text color={row.color}>{pad(row.label, 16)}</Text>
        <Text> {bar} </Text>
        <Text>{row.tokens.toLocaleString().padStart(9)}</Text>
        <Text dimColor>{"  "}{pctLabel}</Text>
        {!row.precise && <Text dimColor>  approx</Text>}
      </Text>
    </Box>
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
