import { Box, Text } from "ink";

interface Group {
  title: string;
  rows: Array<[string, string]>;
}

const GROUPS: Group[] = [
  {
    title: "Navigate",
    rows: [
      ["↑ ↓ / j k", "move selection in timeline"],
      ["enter", "open event detail pane"],
      ["esc", "close current view / clear selection"],
      ["P", "projects grid — every workspace on this machine"],
      ["enter on project", "sessions list for that project (by date)"],
      ["enter on session", "scoped timeline for that session"],
      ["q / ctrl-c", "quit agentwatch"],
    ],
  },
  {
    title: "Filter & scope",
    rows: [
      ["/", "full-text search (summary, path, cmd, tool, text)"],
      ["f", "cycle agent filter (claude / openclaw / cursor / …)"],
      ["a", "toggle agent side panel"],
      ["x", "drill into selected Agent event's subagent run"],
      ["X", "unscope subagent"],
      ["A", "clear project filter"],
    ],
  },
  {
    title: "Actions",
    rows: [
      ["y", "yank selected event content to clipboard"],
      ["space", "pause / resume live event stream"],
      ["c", "clear event buffer"],
    ],
  },
  {
    title: "Info views",
    rows: [
      ["p", "permissions view (Claude + Cursor + OpenClaw)"],
      ["↑↓ / j k inside permissions", "scroll"],
    ],
  },
  {
    title: "Detail pane (open with enter)",
    rows: [
      ["↑ ↓ / j k", "scroll detail content"],
      ["esc", "close detail"],
    ],
  },
  {
    title: "Help",
    rows: [
      ["?", "toggle this help"],
      ["esc", "close this help"],
    ],
  },
];

export function HelpView() {
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color="cyan">
        agentwatch — keybindings
      </Text>
      <Text dimColor>Press ? or esc to close.</Text>
      {GROUPS.map((g) => (
        <Box key={g.title} flexDirection="column" marginTop={1}>
          <Text bold color="yellow">
            {g.title}
          </Text>
          {g.rows.map(([k, d]) => (
            <Text key={k}>
              <Text color="green">{pad(k, 34)}</Text>
              <Text> {d}</Text>
            </Text>
          ))}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>
          docs: github.com/mishanefedov/agentwatch · issues + feature requests welcome
        </Text>
      </Box>
    </Box>
  );
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
