import { Box, Text } from "ink";
import type { SearchHit } from "../util/cross-search.js";

interface Props {
  query: string;
  hits: SearchHit[];
  selectedIdx: number;
  viewportRows: number;
}

export function CrossSearchView({ query, hits, selectedIdx, viewportRows }: Props) {
  const height = Math.max(3, viewportRows);
  const first = Math.max(0, Math.min(hits.length - height, selectedIdx - 2));
  const visible = hits.slice(first, first + height);
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text>
        <Text bold color="cyan">Cross-session search  </Text>
        <Text dimColor>query: </Text>
        <Text>{query || "(empty)"}</Text>
        <Text dimColor>  · {hits.length} hit{hits.length === 1 ? "" : "s"}</Text>
      </Text>
      <Text dimColor>[↑↓] select  [enter] open session  [esc] back</Text>
      <Box flexDirection="column" marginTop={1}>
        {hits.length === 0 ? (
          <Text dimColor>(no matches)</Text>
        ) : (
          visible.map((h, i) => (
            <Row key={first + i} hit={h} selected={first + i === selectedIdx} />
          ))
        )}
      </Box>
    </Box>
  );
}

function Row({ hit, selected }: { hit: SearchHit; selected: boolean }) {
  return (
    <Text wrap="truncate" inverse={selected}>
      <Text color="yellow">{selected ? "▶ " : "  "}</Text>
      <Text color={hit.agent === "claude-code" ? "cyan" : "green"}>
        {pad(`[${hit.agent}]`, 15)}
      </Text>
      <Text dimColor>{pad(hit.project || "(no project)", 14)}</Text>
      <Text dimColor>{pad(hit.sessionId.slice(0, 10), 11)}</Text>
      <Text>{truncate(hit.line.trim(), 60)}</Text>
    </Text>
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) + " " : s + " ".repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
