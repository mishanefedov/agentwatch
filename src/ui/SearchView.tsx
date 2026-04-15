import { Box, Text } from "ink";
import type { AgentEvent } from "../schema.js";
import type { SearchHit as BmHit } from "../util/cross-search.js";
import type { SearchHit as SemHit } from "../util/semantic-index.js";

export type SearchMode = "live" | "cross" | "semantic";

export type UnifiedHit =
  | { kind: "live"; event: AgentEvent }
  | { kind: "cross"; hit: BmHit }
  | { kind: "semantic"; hit: SemHit };

interface Props {
  mode: SearchMode;
  query: string;
  typing: boolean;
  hits: UnifiedHit[];
  selectedIdx: number;
  viewportRows: number;
  /** Status text for long-running operations (e.g. semantic indexing). */
  statusText: string | null;
  /** When set, the first-run consent modal is shown over the panel. */
  confirming: { query: string } | null;
}

const MODE_LABELS: Record<SearchMode, string> = {
  live: "Live timeline (substring, fast)",
  cross: "Cross-session (every JSONL on disk)",
  semantic: "Semantic (BM25 + local embeddings)",
};

const MODE_HINTS: Record<SearchMode, string> = {
  live:
    "Searches the 500-event ring buffer in memory. Substring match on summary, path, cmd, tool, full text.",
  cross:
    "Searches every Claude / Codex / Gemini / OpenClaw session file on disk. Substring match.",
  semantic:
    "Hybrid BM25 + sentence-embedding ranking over a local SQLite index. First run downloads ~80 MB.",
};

export function SearchView({
  mode,
  query,
  typing,
  hits,
  selectedIdx,
  viewportRows,
  statusText,
  confirming,
}: Props) {
  if (confirming) {
    return (
      <Box flexDirection="column" borderStyle="double" borderColor="yellow" paddingX={1}>
        <Text bold color="yellow">First-run setup — semantic search</Text>
        <Text> </Text>
        <Text>
          Semantic search needs to download a sentence-embedding model
          (<Text bold>bge-small-en-v1.5</Text>, ~80 MB) and build a local
          index of every session file on disk.
        </Text>
        <Text> </Text>
        <Text dimColor>Downloaded to:  ~/.agentwatch/models/</Text>
        <Text dimColor>Index at:       ~/.agentwatch/index.sqlite</Text>
        <Text dimColor>Estimated time: ~20s download + 1–3 min indexing</Text>
        <Text dimColor>Disk use:       ~100 MB (model) + ~50–150 MB (index)</Text>
        <Text dimColor>Network:        one-time HTTPS fetch from huggingface.co</Text>
        <Text> </Text>
        <Text>Query: <Text color="cyan">{confirming.query}</Text></Text>
        <Text> </Text>
        <Text bold>
          Proceed?  <Text color="green">[y]</Text> yes{"  "}
          <Text color="red">[n]</Text> no  (esc cancels)
        </Text>
      </Box>
    );
  }

  const height = Math.max(3, viewportRows - 4);
  const first = Math.max(0, Math.min(hits.length - height, selectedIdx - 2));
  const visible = hits.slice(first, first + height);

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text>
        <Text bold color="cyan">Search  </Text>
        <Tab active={mode === "live"} label="1 live" />
        <Text>  </Text>
        <Tab active={mode === "cross"} label="2 cross-session" />
        <Text>  </Text>
        <Tab active={mode === "semantic"} label="3 semantic" />
      </Text>
      <Text dimColor>{MODE_LABELS[mode]}</Text>
      <Text dimColor>{MODE_HINTS[mode]}</Text>
      <Box marginTop={1}>
        <Text>
          <Text color="yellow">/ </Text>
          <Text>{query || ""}</Text>
          {typing && <Text color="yellow">▌</Text>}
          <Text dimColor>   {hits.length} hit{hits.length === 1 ? "" : "s"}</Text>
        </Text>
      </Box>
      <Text dimColor>
        [tab / 1 2 3] mode  [enter] run  [↑↓] select  [enter] open  [esc] back
      </Text>
      {statusText && <Text color="yellow">{statusText}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {hits.length === 0 ? (
          <EmptyHint mode={mode} query={query} typing={typing} statusText={statusText} />
        ) : (
          visible.map((h, i) => (
            <Row key={first + i} hit={h} selected={first + i === selectedIdx} />
          ))
        )}
      </Box>
    </Box>
  );
}

function EmptyHint({
  mode,
  query,
  typing,
  statusText,
}: {
  mode: SearchMode;
  query: string;
  typing: boolean;
  statusText: string | null;
}) {
  if (statusText) return <Text dimColor>{statusText}</Text>;
  if (!query) return <Text dimColor>(type a query, then enter to run)</Text>;
  if (typing) {
    return (
      <Text dimColor>
        (press enter to run {mode} search; tab to switch mode)
      </Text>
    );
  }
  if (mode === "semantic") {
    return (
      <Text dimColor>
        (no semantic results — index may be empty. Press enter to rebuild.)
      </Text>
    );
  }
  return <Text dimColor>(no matches)</Text>;
}

function Tab({ active, label }: { active: boolean; label: string }) {
  return (
    <Text
      color={active ? "cyan" : undefined}
      dimColor={!active}
      bold={active}
    >
      {active ? `▶ ${label}` : `  ${label}`}
    </Text>
  );
}

function Row({ hit, selected }: { hit: UnifiedHit; selected: boolean }) {
  if (hit.kind === "live") {
    const e = hit.event;
    const summary = e.summary ?? e.path ?? e.cmd ?? e.tool ?? e.type;
    return (
      <Text wrap="truncate" inverse={selected}>
        <Text color="yellow">{selected ? "▶ " : "  "}</Text>
        <Text dimColor>{e.ts.slice(11, 19)} </Text>
        <Text color={agentColor(e.agent)}>{pad(e.agent, 12)}</Text>
        <Text dimColor>{pad(e.type, 12)}</Text>
        <Text>{summary}</Text>
      </Text>
    );
  }
  if (hit.kind === "cross") {
    const h = hit.hit;
    return (
      <Text wrap="truncate" inverse={selected}>
        <Text color="yellow">{selected ? "▶ " : "  "}</Text>
        <Text color={agentColor(h.agent)}>{pad(h.agent, 12)}</Text>
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
      <Text color={agentColor(h.agent)}>{pad(h.agent, 12)}</Text>
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
