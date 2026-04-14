import { useEffect, useReducer, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { AgentEvent, AgentName } from "../schema.js";
import { Timeline } from "./Timeline.js";
import { AgentPanel } from "./AgentPanel.js";
import { Header } from "./Header.js";
import { PermissionView } from "./PermissionView.js";
import { EventDetail, totalDetailRows } from "./EventDetail.js";
import { detectAgents } from "../adapters/detect.js";
import { startClaudeAdapter } from "../adapters/claude-code.js";
import { startOpenClawAdapter } from "../adapters/openclaw.js";
import { startCursorAdapter } from "../adapters/cursor.js";
import { startFsAdapter } from "../adapters/fs-watcher.js";
import { detectWorkspaceRoot } from "../util/workspace.js";
import { readClaudePermissions } from "../util/claude-permissions.js";
import { readOpenClawConfig } from "../util/openclaw-config.js";
import type { CursorStatus } from "../adapters/cursor.js";

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
  /** Index into the *filtered* list; null = no selection */
  selectedIdx: number | null;
  detailOpen: boolean;
  detailScroll: number;
};

type Action =
  | { type: "event"; event: AgentEvent }
  | { type: "toggle-agents" }
  | { type: "toggle-permissions" }
  | { type: "cycle-filter"; agents: AgentName[] }
  | { type: "toggle-pause" }
  | { type: "clear" }
  | { type: "move"; delta: number; max: number }
  | { type: "open-detail" }
  | { type: "close-detail" }
  | { type: "scroll-detail"; delta: number; max: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "event": {
      if (state.paused) return state;
      const next = state.events.slice();
      const idx = findInsertIdx(next, action.event.ts);
      next.splice(idx, 0, action.event);
      if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
      // If the user is currently on a selected row, keep the cursor on the
      // same event by shifting its index when a newer event is inserted
      // above it.
      let sel = state.selectedIdx;
      if (sel !== null && idx <= sel) sel = sel + 1;
      return { ...state, events: next, selectedIdx: sel };
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
      return { ...state, filterAgent: next ?? null, selectedIdx: null };
    }
    case "toggle-pause":
      return { ...state, paused: !state.paused };
    case "clear":
      return { ...state, events: [], selectedIdx: null };
    case "move": {
      if (action.max <= 0) return state;
      const cur = state.selectedIdx ?? -1;
      const next = Math.max(0, Math.min(action.max - 1, cur + action.delta));
      return { ...state, selectedIdx: next };
    }
    case "open-detail":
      if (state.selectedIdx === null) return state;
      return { ...state, detailOpen: true, detailScroll: 0 };
    case "close-detail":
      return { ...state, detailOpen: false, detailScroll: 0 };
    case "scroll-detail": {
      const next = Math.max(0, Math.min(action.max, state.detailScroll + action.delta));
      return { ...state, detailScroll: next };
    }
  }
}

export function App() {
  const { exit } = useApp();
  const [workspace] = useState(detectWorkspaceRoot());
  const [agents] = useState(detectAgents());
  const [claudePerms] = useState(() => readClaudePermissions(workspace));
  const [openclawCfg] = useState(() => readOpenClawConfig());
  const [cursorStatus, setCursorStatus] = useState<CursorStatus | undefined>(
    undefined,
  );
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(reducer, {
    events: [],
    filterAgent: null,
    showAgents: true,
    showPermissions: false,
    paused: false,
    selectedIdx: null,
    detailOpen: false,
    detailScroll: 0,
  });

  useEffect(() => {
    const onEvent = (e: AgentEvent) =>
      dispatch({ type: "event", event: e });
    const stopClaude = startClaudeAdapter(onEvent);
    const stopOpenClaw = startOpenClawAdapter(onEvent);
    const cursor = startCursorAdapter(workspace, onEvent);
    setCursorStatus(cursor.status);
    const stopFs = startFsAdapter(workspace, onEvent);
    return () => {
      stopClaude();
      stopOpenClaw();
      cursor.stop();
      stopFs();
    };
  }, [workspace]);

  const filtered = state.filterAgent
    ? state.events.filter((e) => e.agent === state.filterAgent)
    : state.events;

  const cols = stdout.columns || 120;
  const rows = stdout.rows || 30;
  const selectedEvent =
    state.selectedIdx !== null ? filtered[state.selectedIdx] : undefined;
  const detailRowCount = selectedEvent
    ? totalDetailRows(selectedEvent, cols - 6)
    : 0;

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      setImmediate(() => process.exit(0));
      return;
    }
    if (state.detailOpen) {
      if (key.escape || input === "q") {
        dispatch({ type: "close-detail" });
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({ type: "scroll-detail", delta: 1, max: Math.max(0, detailRowCount - (rows - 10)) });
        return;
      }
      if (key.upArrow || input === "k") {
        dispatch({ type: "scroll-detail", delta: -1, max: Math.max(0, detailRowCount - (rows - 10)) });
        return;
      }
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
    if (key.downArrow || input === "j")
      dispatch({ type: "move", delta: 1, max: filtered.length });
    if (key.upArrow || input === "k")
      dispatch({ type: "move", delta: -1, max: filtered.length });
    if (key.return || input === "l") dispatch({ type: "open-detail" });
    if (key.escape) {
      // clear selection
      if (state.selectedIdx !== null) {
        dispatch({ type: "move", delta: -(state.selectedIdx + 99999), max: 1 });
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        workspace={workspace}
        eventCount={state.events.length}
        filter={state.filterAgent}
        paused={state.paused}
      />
      {state.detailOpen && selectedEvent ? (
        <EventDetail
          event={selectedEvent}
          width={cols}
          height={rows - 4}
          scrollOffset={state.detailScroll}
        />
      ) : state.showPermissions ? (
        <PermissionView
          claude={claudePerms}
          cursor={cursorStatus}
          openclaw={openclawCfg}
        />
      ) : (
        <Box flexDirection="row">
          <Box flexGrow={1} flexDirection="column">
            <Timeline events={filtered} selectedIdx={state.selectedIdx} />
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
          {state.detailOpen
            ? "[esc] close  [↑↓] scroll"
            : `[q] quit  [↑↓] select  [enter] detail  [a] agents  [f] filter  [p] permissions  [space] ${state.paused ? "resume" : "pause"}  [c] clear`}
        </Text>
      </Box>
    </Box>
  );
}
