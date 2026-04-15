import { Box, Text } from "ink";
import type {
  TokenBreakdown,
  TurnBreakdown,
} from "../util/token-attribution.js";
import { totalTokens } from "../util/token-attribution.js";
import { formatUSD } from "../util/cost.js";

interface Props {
  breakdown: TokenBreakdown;
  turns: TurnBreakdown[];
  sessionId: string;
  /** Index of the selected turn row; clamped to turns.length - 1. */
  selectedIdx: number;
  viewportRows: number;
}

const CATEGORIES: {
  key: keyof TurnBreakdown;
  label: string;
  color: string;
}[] = [
  { key: "user", label: "user", color: "gray" },
  { key: "claudeMd", label: "CLAUDE.md", color: "magenta" },
  { key: "toolIO", label: "tool I/O", color: "white" },
  { key: "thinking", label: "thinking", color: "blue" },
  { key: "input", label: "input (fresh)", color: "cyan" },
  { key: "cacheRead", label: "cache read", color: "green" },
  { key: "cacheCreate", label: "cache create", color: "yellow" },
  { key: "output", label: "output", color: "redBright" },
];

export function TokensView({
  breakdown,
  turns,
  sessionId,
  selectedIdx,
  viewportRows,
}: Props) {
  const total = totalTokens(breakdown) + breakdown.thinking + breakdown.toolIO + breakdown.user + breakdown.claudeMd;
  const aggregateRows = CATEGORIES.map((c) => {
    const key = c.key as keyof TokenBreakdown;
    const val = (breakdown[key] as number) ?? 0;
    return { ...c, tokens: val };
  });

  const selected = turns[selectedIdx] ?? turns[turns.length - 1];
  const maxTurnTotal = Math.max(
    1,
    ...turns.map((t) => turnTotal(t)),
  );

  const visibleTurns = turns.slice(
    Math.max(0, selectedIdx - 4),
    Math.max(0, selectedIdx - 4) + Math.max(3, viewportRows - 12),
  );

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
      <Text dimColor>[↑↓] select turn  [t] close  [esc] back</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>Aggregate (session total)</Text>
        {aggregateRows.map((r) => (
          <AggregateRow key={r.label} row={r} total={total} />
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>
          Per turn (bar width ∝ total tokens that turn)
        </Text>
        {turns.length === 0 ? (
          <Text dimColor>(no assistant turns yet)</Text>
        ) : (
          visibleTurns.map((t) => (
            <TurnRow
              key={t.turnIdx}
              turn={t}
              selected={t.turnIdx === selected?.turnIdx}
              maxTotal={maxTurnTotal}
            />
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Tokens counted with a local cl100k_base tokenizer (gpt-tokenizer).
          Claude's tokenizer is similar but not identical — expect ±5% vs
          Anthropic's own counts. Usage numbers (input/cache/output) come
          from the model's own usage record and are exact.
        </Text>
      </Box>
    </Box>
  );
}

function AggregateRow({
  row,
  total,
}: {
  row: { label: string; tokens: number; color: string };
  total: number;
}) {
  const barWidth = 30;
  const pct = total > 0 ? row.tokens / total : 0;
  const filled = Math.round(pct * barWidth);
  const bar = "█".repeat(filled) + "·".repeat(Math.max(0, barWidth - filled));
  return (
    <Text>
      <Text color={row.color}>{pad(row.label, 16)}</Text>
      <Text> {bar} </Text>
      <Text>{row.tokens.toLocaleString().padStart(9)}</Text>
      <Text dimColor>
        {"  "}
        {`${(pct * 100).toFixed(1).padStart(5)}%`}
      </Text>
    </Text>
  );
}

function TurnRow({
  turn,
  selected,
  maxTotal,
}: {
  turn: TurnBreakdown;
  selected: boolean;
  maxTotal: number;
}) {
  const barWidth = 40;
  const total = turnTotal(turn);
  const totalFilled = Math.round((total / maxTotal) * barWidth);
  const bar = CATEGORIES.map((c) => {
    const val = (turn[c.key as keyof TurnBreakdown] as number) ?? 0;
    const width = total > 0 ? Math.round((val / total) * totalFilled) : 0;
    return { color: c.color, width };
  });
  return (
    <Box>
      <Text inverse={selected}>
        <Text dimColor>{`t${turn.turnIdx}`.padStart(4)}</Text>
        <Text> </Text>
        {bar.map((b, i) => (
          <Text key={i} color={b.color}>
            {"█".repeat(b.width)}
          </Text>
        ))}
        <Text>
          {"·".repeat(Math.max(0, barWidth - bar.reduce((a, b) => a + b.width, 0)))}
        </Text>
        <Text> {total.toLocaleString().padStart(7)}</Text>
        {turn.cost > 0 && (
          <Text dimColor>{"  "}{formatUSD(turn.cost)}</Text>
        )}
      </Text>
    </Box>
  );
}

function turnTotal(t: TurnBreakdown): number {
  return (
    t.user +
    t.claudeMd +
    t.toolIO +
    t.thinking +
    t.input +
    t.cacheRead +
    t.cacheCreate +
    t.output
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
