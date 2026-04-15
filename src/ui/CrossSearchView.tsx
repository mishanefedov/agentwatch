import { Box, Text } from "ink";
import type { SearchHit as BmHit } from "../util/cross-search.js";
import type { SearchHit as SemHit } from "../util/semantic-index.js";

export type UnifiedHit =
  | { kind: "bm25"; hit: BmHit }
  | { kind: "semantic"; hit: SemHit };

interface Props {
  query: string;
  hits: UnifiedHit[];
  selectedIdx: number;
  viewportRows: number;
  mode: "bm25" | "semantic";
  /** When semantic search is busy (embedding + indexing), show a
   *  progress line instead of (or alongside) the results. */
  indexingStatus?: string | null;
}

export function CrossSearchView({
  query,
  hits,
  selectedIdx,
  viewportRows,
  mode,
  indexingStatus,
}: Props) {
  const height = Math.max(3, viewportRows);
  const first = Math.max(0, Math.min(hits.length - height, selectedIdx - 2));
  const visible = hits.slice(first, first + height);
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text>
        <Text bold color="cyan">
          {mode === "semantic"
            ? "Semantic search (hybrid BM25 + embeddings)"
            : "Cross-session search (substring)"}
        </Text>
        <Text>  </Text>
        <Text dimColor>query: </Text>
        <Text>{query || "(empty)"}</Text>
        <Text dimColor>  · {hits.length} hit{hits.length === 1 ? "" : "s"}</Text>
      </Text>
      <Text dimColor>
        [↑↓] select  [enter] open session  [s] toggle semantic  [esc] back
      </Text>
      {indexingStatus && (
        <Text color="yellow">{indexingStatus}</Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {hits.length === 0 ? (
          <Text dimColor>(no matches)</Text>
        ) : (
          visible.map((h, i) => (
            <Row
              key={first + i}
              hit={h}
              selected={first + i === selectedIdx}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

function Row({ hit, selected }: { hit: UnifiedHit; selected: boolean }) {
  if (hit.kind === "bm25") {
    const h = hit.hit;
    return (
      <Text wrap="truncate" inverse={selected}>
        <Text color="yellow">{selected ? "▶ " : "  "}</Text>
        <Text color={agentColor(h.agent)}>{pad(`[${h.agent}]`, 15)}</Text>
        <Text dimColor>{pad(h.project || "(no project)", 14)}</Text>
        <Text dimColor>{pad(h.sessionId.slice(0, 10), 11)}</Text>
        <Text>{truncate(h.line.trim(), 60)}</Text>
      </Text>
    );
  }
  const h = hit.hit;
  const srcColor =
    h.source === "H" ? "magenta" : h.source === "V" ? "blue" : "cyan";
  return (
    <Text wrap="truncate" inverse={selected}>
      <Text color="yellow">{selected ? "▶ " : "  "}</Text>
      <Text color={srcColor}>{pad(h.source, 2)}</Text>
      <Text color={agentColor(h.agent)}>{pad(`[${h.agent}]`, 15)}</Text>
      <Text dimColor>{pad(h.project || "(no project)", 14)}</Text>
      <Text dimColor>{pad("t" + h.turnIdx, 5)}</Text>
      <Text>{truncate(h.label || h.sessionId.slice(0, 12), 60)}</Text>
      <Text dimColor>  {h.score.toFixed(3)}</Text>
    </Text>
  );
}

function agentColor(agent: string): string {
  switch (agent) {
    case "claude-code": return "cyan";
    case "codex": return "green";
    case "gemini": return "blue";
    case "cursor": return "magenta";
    case "openclaw": return "yellow";
    default: return "white";
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) + " " : s + " ".repeat(n - s.length);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
