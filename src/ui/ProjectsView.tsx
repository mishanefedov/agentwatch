import { Box, Text } from "ink";
import type { ProjectRow } from "../util/project-index.js";
import { agoFromNow, isStale } from "../util/project-index.js";
import { formatUSD } from "../util/cost.js";
import type { AgentName } from "../schema.js";

interface Props {
  projects: ProjectRow[];
  selectedIdx: number;
  searchQuery: string;
}

export function ProjectsView({ projects, selectedIdx, searchQuery }: Props) {
  const filtered = searchQuery
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : projects;

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color="cyan">
        Projects — {filtered.length} workspace{filtered.length === 1 ? "" : "s"}
      </Text>
      <Text dimColor>
        sorted by last activity · enter to filter timeline · esc to close
      </Text>
      <Box marginTop={1} flexDirection="column">
        {filtered.length === 0 ? (
          <Text dimColor>
            No projects yet. Use Claude Code / OpenClaw / Cursor and they'll
            show up here as events stream in.
          </Text>
        ) : (
          filtered.map((p, i) => (
            <ProjectRowView
              key={p.name}
              row={p}
              selected={i === selectedIdx}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

function ProjectRowView({
  row,
  selected,
}: {
  row: ProjectRow;
  selected: boolean;
}) {
  const agentCounts = Array.from(row.byAgent.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, n]) => `${shortName(name)}:${n}`)
    .join("  ");
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text inverse={selected} dimColor={isStale(row.lastTs)}>
        <Text color="yellow" bold>
          {selected ? "▶ " : "  "}
        </Text>
        <Text bold>{row.name.padEnd(26)}</Text>
        <Text dimColor>  {agoFromNow(row.lastTs).padStart(10)}</Text>
        {row.cost > 0 && (
          <Text dimColor>
            {"  "}
            <Text color={isStale(row.lastTs) ? undefined : "yellow"}>{formatUSD(row.cost)}</Text>
          </Text>
        )}
        {isStale(row.lastTs) && <Text dimColor> · ⊘ stale</Text>}
      </Text>
      <Text dimColor>
        {"  "}
        {row.events} events · {row.sessions.size} session
        {row.sessions.size === 1 ? "" : "s"} · {agentCounts}
      </Text>
    </Box>
  );
}

function shortName(a: AgentName): string {
  switch (a) {
    case "claude-code": return "claude";
    case "openclaw": return "openclaw";
    case "cursor": return "cursor";
    case "codex": return "codex";
    case "gemini": return "gemini";
    default: return a;
  }
}
