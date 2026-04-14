import { useEffect, useReducer, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { AgentEvent, AgentName, EventDetails, EventSink } from "../schema.js";
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

function matchesQuery(e: AgentEvent, q: string): boolean {
  const needle = q.toLowerCase();
  if ((e.summary ?? "").toLowerCase().includes(needle)) return true;
  if ((e.path ?? "").toLowerCase().includes(needle)) return true;
  if ((e.cmd ?? "").toLowerCase().includes(needle)) return true;
  if ((e.tool ?? "").toLowerCase().includes(needle)) return true;
  if ((e.agent ?? "").toLowerCase().includes(needle)) return true;
  const d = e.details;
  if (d) {
    if ((d.fullText ?? "").toLowerCase().includes(needle)) return true;
    if ((d.thinking ?? "").toLowerCase().includes(needle)) return true;
  }
  return false;
}

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
  searchOpen: boolean;
  searchQuery: string;
  /** When set, timeline is scoped to events whose sessionId ends with
   *  `agent-<subAgentScope>` OR whose details.subAgentId === scope. */
  subAgentScope: string | null;
  /** Event ids whose inline expansion is currently open. */
  expandedIds: Set<string>;
};

type Action =
  | { type: "event"; event: AgentEvent }
  | { type: "enrich"; eventId: string; patch: Partial<EventDetails> }
  | { type: "toggle-agents" }
  | { type: "toggle-permissions" }
  | { type: "cycle-filter"; agents: AgentName[] }
  | { type: "toggle-pause" }
  | { type: "clear" }
  | { type: "move"; delta: number; max: number }
  | { type: "open-detail" }
  | { type: "close-detail" }
  | { type: "scroll-detail"; delta: number; max: number }
  | { type: "open-search" }
  | { type: "close-search" }
  | { type: "search-input"; char: string }
  | { type: "search-backspace" }
  | { type: "scope-subagent"; subAgentId: string }
  | { type: "unscope-subagent" }
  | { type: "toggle-expand"; eventId: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "event": {
      if (state.paused) return state;
      const next = state.events.slice();
      const idx = findInsertIdx(next, action.event.ts);
      next.splice(idx, 0, action.event);
      if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
      let sel = state.selectedIdx;
      if (sel !== null && idx <= sel) sel = sel + 1;
      return { ...state, events: next, selectedIdx: sel };
    }
    case "enrich": {
      const next = state.events.slice();
      for (let i = 0; i < next.length; i++) {
        if (next[i]!.id !== action.eventId) continue;
        const e = next[i]!;
        next[i] = {
          ...e,
          details: { ...(e.details ?? {}), ...action.patch },
        };
        return { ...state, events: next };
      }
      return state;
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
    case "open-search":
      return { ...state, searchOpen: true, selectedIdx: null };
    case "close-search":
      return { ...state, searchOpen: false, searchQuery: "" };
    case "search-input":
      return {
        ...state,
        searchQuery: state.searchQuery + action.char,
        selectedIdx: null,
      };
    case "search-backspace":
      return {
        ...state,
        searchQuery: state.searchQuery.slice(0, -1),
        selectedIdx: null,
      };
    case "scope-subagent":
      return {
        ...state,
        subAgentScope: action.subAgentId,
        selectedIdx: null,
        detailOpen: false,
      };
    case "unscope-subagent":
      return { ...state, subAgentScope: null, selectedIdx: null };
    case "toggle-expand": {
      const next = new Set(state.expandedIds);
      if (next.has(action.eventId)) next.delete(action.eventId);
      else next.add(action.eventId);
      return { ...state, expandedIds: next };
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
    searchOpen: false,
    searchQuery: "",
    subAgentScope: null,
    expandedIds: new Set<string>(),
  });

  useEffect(() => {
    const sink: EventSink = {
      emit: (e: AgentEvent) => dispatch({ type: "event", event: e }),
      enrich: (eventId: string, patch: Partial<EventDetails>) =>
        dispatch({ type: "enrich", eventId, patch }),
    };
    const stopClaude = startClaudeAdapter(sink);
    const stopOpenClaw = startOpenClawAdapter(sink);
    const cursor = startCursorAdapter(workspace, sink);
    setCursorStatus(cursor.status);
    const stopFs = startFsAdapter(workspace, sink);
    return () => {
      stopClaude();
      stopOpenClaw();
      cursor.stop();
      stopFs();
    };
  }, [workspace]);

  const agentFiltered = state.filterAgent
    ? state.events.filter((e) => e.agent === state.filterAgent)
    : state.events;
  const scoped = state.subAgentScope
    ? agentFiltered.filter(
        (e) =>
          e.sessionId === `agent-${state.subAgentScope}` ||
          e.sessionId === state.subAgentScope ||
          e.details?.subAgentId === state.subAgentScope,
      )
    : agentFiltered;
  const filtered = state.searchQuery
    ? scoped.filter((e) => matchesQuery(e, state.searchQuery))
    : scoped;

  // Build a parent→child count index for Agent tool_use events
  const childCountByAgentId = new Map<string, number>();
  for (const e of state.events) {
    if (e.sessionId?.startsWith("agent-")) {
      const aid = e.sessionId.slice("agent-".length);
      childCountByAgentId.set(aid, (childCountByAgentId.get(aid) ?? 0) + 1);
    }
  }

  const cols = stdout.columns || 120;
  const rows = stdout.rows || 30;
  const selectedEvent =
    state.selectedIdx !== null ? filtered[state.selectedIdx] : undefined;
  const detailRowCount = selectedEvent
    ? totalDetailRows(selectedEvent, cols - 6)
    : 0;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      setImmediate(() => process.exit(0));
      return;
    }

    // Search-input mode: capture typing into the query buffer
    if (state.searchOpen) {
      if (key.escape) {
        dispatch({ type: "close-search" });
        return;
      }
      if (key.return) {
        // Keep the query applied as a sticky filter; just exit input mode.
        // We signal this by dispatching close-search and immediately restoring
        // the query — simpler: the reducer's close-search clears the query,
        // so instead we add a dedicated confirm action. But for MVP, the
        // behaviour "Enter applies + exits" is achieved by flipping a flag
        // only: we leave searchOpen true visually (no cursor). Simplest
        // correct behaviour: Enter does nothing destructive, esc closes.
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: "search-backspace" });
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        dispatch({ type: "search-input", char: input });
        return;
      }
      return;
    }

    if (input === "q") {
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
    if (input === "/") dispatch({ type: "open-search" });
    if (input === "x" && state.selectedIdx !== null) {
      const ev = filtered[state.selectedIdx];
      const sid = ev?.details?.subAgentId;
      if (sid) dispatch({ type: "scope-subagent", subAgentId: sid });
    }
    if ((key.rightArrow || input === "o") && state.selectedIdx !== null) {
      const ev = filtered[state.selectedIdx];
      if (ev) dispatch({ type: "toggle-expand", eventId: ev.id });
    }
    if (key.leftArrow && state.selectedIdx !== null) {
      const ev = filtered[state.selectedIdx];
      if (ev && state.expandedIds.has(ev.id))
        dispatch({ type: "toggle-expand", eventId: ev.id });
    }
    if (input === "X") dispatch({ type: "unscope-subagent" });
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
            <Timeline
              events={filtered}
              selectedIdx={state.selectedIdx}
              childCountByAgentId={childCountByAgentId}
              expandedIds={state.expandedIds}
            />
          </Box>
          {state.showAgents && (
            <Box width={32} marginLeft={1}>
              <AgentPanel agents={agents} events={state.events} />
            </Box>
          )}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {state.subAgentScope && (
          <Text>
            <Text color="yellow">↳ scoped to subagent </Text>
            <Text bold>{state.subAgentScope.slice(0, 12)}</Text>
            <Text dimColor>   (X to unscope)</Text>
          </Text>
        )}
        {(state.searchOpen || state.searchQuery) && (
          <Text>
            <Text color="yellow">/ </Text>
            <Text>{state.searchQuery}</Text>
            {state.searchOpen && <Text color="yellow">▌</Text>}
            {state.searchQuery && (
              <Text dimColor>   matches: {filtered.length}</Text>
            )}
          </Text>
        )}
        <Text dimColor>
          {state.searchOpen
            ? "[type to search]  [enter] confirm  [esc] clear"
            : state.detailOpen
              ? "[esc] close  [↑↓] scroll"
              : `[q] quit  [↑↓] select  [→] expand  [enter] detail  [x] drill subagent  [/] search  [a] agents  [f] filter  [p] permissions  [space] ${state.paused ? "resume" : "pause"}  [c] clear`}
        </Text>
      </Box>
    </Box>
  );
}
