import { Box, Text } from "ink";
import type { AgentEvent } from "../schema.js";
import { formatUSD } from "../util/cost.js";

interface Props {
  event: AgentEvent;
  width: number;
  height: number;
  scrollOffset: number;
}

export function EventDetail({ event, width, height, scrollOffset }: Props) {
  const rows = buildRows(event, width);
  const visible = rows.slice(scrollOffset, scrollOffset + height - 4);

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color={colorFor(event)}>
        {event.ts.slice(11, 19)} — {event.agent} — {event.type}
        {event.tool ? `  (${event.tool})` : ""}
      </Text>
      {event.path && (
        <Text dimColor>path: {event.path}</Text>
      )}
      {event.cmd && (
        <Text dimColor>cmd: {truncateLine(event.cmd, width - 6)}</Text>
      )}
      <Box marginTop={1} flexDirection="column">
        {visible.length === 0 ? (
          <Text dimColor>(no additional content captured for this event)</Text>
        ) : (
          visible.map((r, i) => <Row key={i} row={r} />)
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {rows.length > height - 4
            ? `${scrollOffset + 1}–${Math.min(scrollOffset + height - 4, rows.length)} of ${rows.length}  ↑↓ scroll  `
            : ""}
          [esc] close
        </Text>
      </Box>
    </Box>
  );
}

type Row =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string; dim?: boolean };

function buildRows(event: AgentEvent, width: number): Row[] {
  const d = event.details;
  const rows: Row[] = [];
  const max = Math.max(40, width - 4);

  if (d?.usage || d?.cost != null || d?.durationMs != null) {
    rows.push({ kind: "heading", text: "tokens / cost / duration" });
    const u = d?.usage;
    if (u) {
      rows.push({
        kind: "text",
        text: `in=${u.input}  cache_create=${u.cacheCreate}  cache_read=${u.cacheRead}  out=${u.output}`,
        dim: true,
      });
    }
    if (d?.cost != null) {
      rows.push({
        kind: "text",
        text: `cost: ${formatUSD(d.cost)}${d.model ? `  (${d.model})` : ""}`,
        dim: true,
      });
    }
    if (d?.durationMs != null) {
      rows.push({
        kind: "text",
        text: `duration: ${formatDuration(d.durationMs)}${d.toolError ? "  — ERROR" : ""}`,
        dim: true,
      });
    }
  }

  if (d?.toolResult) {
    rows.push({
      kind: "heading",
      text: d.toolError ? "tool result (error)" : "tool result",
    });
    for (const l of wrap(d.toolResult, max)) rows.push({ kind: "text", text: l });
  }

  if (d?.fullText) {
    rows.push({ kind: "heading", text: "text" });
    for (const l of wrap(d.fullText, max)) rows.push({ kind: "text", text: l });
  }

  if (d?.thinking) {
    rows.push({ kind: "heading", text: "extended thinking" });
    for (const l of wrap(d.thinking, max))
      rows.push({ kind: "text", text: l, dim: true });
  }

  if (d?.toolInput) {
    rows.push({ kind: "heading", text: "tool input" });
    const pretty = JSON.stringify(d.toolInput, null, 2);
    for (const l of pretty.split("\n"))
      for (const w of wrap(l, max))
        rows.push({ kind: "text", text: w });
  }

  if (d?.toolUseId) {
    rows.push({ kind: "text", text: "", dim: true });
    rows.push({ kind: "text", text: `tool_use_id: ${d.toolUseId}`, dim: true });
  }

  return rows;
}

function Row({ row }: { row: Row }) {
  if (row.kind === "heading") {
    return (
      <Box marginTop={1}>
        <Text bold color="cyan">— {row.text} —</Text>
      </Box>
    );
  }
  return <Text dimColor={row.dim}>{row.text || " "}</Text>;
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= width) {
      out.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > width) {
      out.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (rest) out.push(rest);
  }
  return out;
}

function truncateLine(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function colorFor(e: AgentEvent): string {
  switch (e.agent) {
    case "claude-code": return "cyan";
    case "openclaw": return "yellow";
    case "cursor": return "magenta";
    case "codex": return "green";
    case "gemini": return "blue";
    default: return "white";
  }
}

export function totalDetailRows(event: AgentEvent, width: number): number {
  return buildRows(event, width).length;
}
