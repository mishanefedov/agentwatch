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
      ["0", "home — reset every view, filter, scope to defaults"],
      ["P", "projects grid — every workspace on this machine"],
      ["enter on project", "sessions list for that project (by date)"],
      ["enter on session", "scoped timeline for that session"],
      ["q / ctrl-c", "quit agentwatch"],
    ],
  },
  {
    title: "Search (unified, opens with /)",
    rows: [
      ["/", "open the unified search overlay"],
      ["tab  /  1 2 3", "switch mode — live · cross-session · semantic"],
      ["enter (typing)", "run search in the active mode"],
      ["↑↓ then enter", "open the selected hit"],
    ],
  },
  {
    title: "Filter & scope",
    rows: [
      ["f", "cycle agent filter (claude / codex / gemini / cursor / openclaw)"],
      ["a", "toggle agent side panel"],
      ["x", "drill into selected Agent event's subagent run"],
      ["X", "unscope subagent"],
      ["A", "clear project filter"],
      ["Z", "clear every active filter / scope at once"],
    ],
  },
  {
    title: "Actions",
    rows: [
      ["y", "yank selected event content to clipboard"],
      ["e", "export current session to ./agentwatch-export/*.{md,json}"],
      ["space", "pause / resume live event stream"],
      ["c", "clear event buffer"],
      ["D", "dismiss the active anomaly banner"],
    ],
  },
  {
    title: "Info views",
    rows: [
      ["p", "permissions (Claude + Codex + Gemini + Cursor + OpenClaw)"],
      ["t", "token attribution (only inside a scoped session)"],
      ["C", "context compaction visualizer (only inside a scoped session)"],
      ["↑↓ / j k inside any view", "scroll"],
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
