import { useEffect, useReducer, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentEvent, AgentName } from "../schema.js";
import { Timeline } from "./Timeline.js";
import { AgentPanel } from "./AgentPanel.js";
import { Header } from "./Header.js";
import { PermissionView } from "./PermissionView.js";
import { detectAgents } from "../adapters/detect.js";
import { startClaudeAdapter } from "../adapters/claude-code.js";
import { startOpenClawAdapter } from "../adapters/openclaw.js";
import { startCursorAdapter } from "../adapters/cursor.js";
import { startFsAdapter } from "../adapters/fs-watcher.js";
import { detectWorkspaceRoot } from "../util/workspace.js";
import { readClaudePermissions } from "../util/claude-permissions.js";

const MAX_EVENTS = 500;

function findInsertIdx(events: AgentEvent[], ts: string): number {
  // Binary search for the first index whose ts is <= incoming ts.
  // Events are sorted newest (largest ts) first.
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.ts > ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

type State = {
  events: AgentEvent[];
  filterAgent: AgentName | null;
  showAgents: boolean;
  showPermissions: boolean;
  paused: boolean;
};

type Action =
  | { type: "event"; event: AgentEvent }
  | { type: "toggle-agents" }
  | { type: "toggle-permissions" }
  | { type: "cycle-filter"; agents: AgentName[] }
  | { type: "toggle-pause" }
  | { type: "clear" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "event": {
      if (state.paused) return state;
      // Insert in reverse-chronological order (newest event ts on top).
      // Backfill arrives out-of-order so we sort on every insert rather than
      // relying on arrival order.
      const next = state.events.slice();
      const idx = findInsertIdx(next, action.event.ts);
      next.splice(idx, 0, action.event);
      if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
      return { ...state, events: next };
    }
    case "toggle-agents":
      return { ...state, showAgents: !state.showAgents };
    case "toggle-permissions":
      return { ...state, showPermissions: !state.showPermissions };
    case "cycle-filter": {
      const idx = state.filterAgent
        ? action.agents.indexOf(state.filterAgent)
        : -1;
      const next =
        idx + 1 >= action.agents.length ? null : action.agents[idx + 1];
      return { ...state, filterAgent: next ?? null };
    }
    case "toggle-pause":
      return { ...state, paused: !state.paused };
    case "clear":
      return { ...state, events: [] };
  }
}

export function App() {
  const { exit } = useApp();
  const [workspace] = useState(detectWorkspaceRoot());
  const [agents] = useState(detectAgents());
  const [permissions] = useState(() => readClaudePermissions(workspace));
  const [state, dispatch] = useReducer(reducer, {
    events: [],
    filterAgent: null,
    showAgents: true,
    showPermissions: false,
    paused: false,
  });

  useEffect(() => {
    const onEvent = (e: AgentEvent) =>
      dispatch({ type: "event", event: e });
    const stopClaude = startClaudeAdapter(onEvent);
    const stopOpenClaw = startOpenClawAdapter(onEvent);
    const cursor = startCursorAdapter(workspace, onEvent);
    const stopFs = startFsAdapter(workspace, onEvent);
    return () => {
      stopClaude();
      stopOpenClaw();
      cursor.stop();
      stopFs();
    };
  }, [workspace]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      // Force-exit: chokidar's watcher.close() is slow and the OS will
      // reap fds anyway. No reason to block the user at shutdown.
      exit();
      setImmediate(() => process.exit(0));
      return;
    }
    if (input === "a") dispatch({ type: "toggle-agents" });
    if (input === "f") {
      const presentAgents = agents.filter((a) => a.present).map((a) => a.name);
      const pool = presentAgents.length
        ? presentAgents
        : (["claude-code", "unknown"] as AgentName[]);
      dispatch({ type: "cycle-filter", agents: pool });
    }
    if (input === " ") dispatch({ type: "toggle-pause" });
    if (input === "p") dispatch({ type: "toggle-permissions" });
    if (input === "c") dispatch({ type: "clear" });
  });

  const filtered = state.filterAgent
    ? state.events.filter((e) => e.agent === state.filterAgent)
    : state.events;

  return (
    <Box flexDirection="column">
      <Header
        workspace={workspace}
        eventCount={state.events.length}
        filter={state.filterAgent}
        paused={state.paused}
      />
      {state.showPermissions ? (
        <PermissionView permissions={permissions} />
      ) : (
        <Box flexDirection="row">
          <Box flexGrow={1} flexDirection="column">
            <Timeline events={filtered} />
          </Box>
          {state.showAgents && (
            <Box width={32} marginLeft={1}>
              <AgentPanel agents={agents} events={state.events} />
            </Box>
          )}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          [q] quit  [a] agents  [f] filter  [p] permissions  [space] {state.paused ? "resume" : "pause"}  [c] clear
        </Text>
      </Box>
    </Box>
  );
}
