import { useEffect, useReducer, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentEvent, AgentName } from "../schema.js";
import { Timeline } from "./Timeline.js";
import { AgentPanel } from "./AgentPanel.js";
import { Header } from "./Header.js";
import { detectAgents } from "../adapters/detect.js";
import { startClaudeAdapter } from "../adapters/claude-code.js";
import { startOpenClawAdapter } from "../adapters/openclaw.js";
import { startFsAdapter } from "../adapters/fs-watcher.js";
import { detectWorkspaceRoot } from "../util/workspace.js";

const MAX_EVENTS = 500;

type State = {
  events: AgentEvent[];
  filterAgent: AgentName | null;
  showAgents: boolean;
  paused: boolean;
};

type Action =
  | { type: "event"; event: AgentEvent }
  | { type: "toggle-agents" }
  | { type: "cycle-filter"; agents: AgentName[] }
  | { type: "toggle-pause" }
  | { type: "clear" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "event": {
      if (state.paused) return state;
      const events = [action.event, ...state.events].slice(0, MAX_EVENTS);
      return { ...state, events };
    }
    case "toggle-agents":
      return { ...state, showAgents: !state.showAgents };
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
  const [state, dispatch] = useReducer(reducer, {
    events: [],
    filterAgent: null,
    showAgents: true,
    paused: false,
  });

  useEffect(() => {
    const onEvent = (e: AgentEvent) =>
      dispatch({ type: "event", event: e });
    const stopClaude = startClaudeAdapter(onEvent);
    const stopOpenClaw = startOpenClawAdapter(onEvent);
    const stopFs = startFsAdapter(workspace, onEvent);
    return () => {
      stopClaude();
      stopOpenClaw();
      stopFs();
    };
  }, [workspace]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) exit();
    if (input === "a") dispatch({ type: "toggle-agents" });
    if (input === "f") {
      const presentAgents = agents.filter((a) => a.present).map((a) => a.name);
      const pool = presentAgents.length
        ? presentAgents
        : (["claude-code", "unknown"] as AgentName[]);
      dispatch({ type: "cycle-filter", agents: pool });
    }
    if (input === "p") dispatch({ type: "toggle-pause" });
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
      <Box marginTop={1}>
        <Text dimColor>
          [q] quit  [a] agents  [f] filter  [p] {state.paused ? "resume" : "pause"}  [c] clear
        </Text>
      </Box>
    </Box>
  );
}
