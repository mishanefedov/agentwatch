import { useEffect, useReducer, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { AgentEvent, AgentName, EventDetails, EventSink } from "../schema.js";
import { Timeline } from "./Timeline.js";
import { AgentPanel } from "./AgentPanel.js";
import { Header } from "./Header.js";
import { PermissionView, permissionRowCount } from "./PermissionView.js";
import { EventDetail, totalDetailRows } from "./EventDetail.js";
import { ProjectsView } from "./ProjectsView.js";
import { SessionsView, sessionLineCount } from "./SessionsView.js";
import { buildProjectIndex, buildSessionRows } from "../util/project-index.js";
import { copyToClipboard, eventToYankText } from "../util/clipboard.js";
import { exportSession } from "../util/export.js";
import { restoreTerminal } from "../util/terminal.js";
import { attributeTokens } from "../util/token-attribution.js";
import { TokensView } from "./TokensView.js";
import { computeBudgetStatus } from "../util/budgets.js";
import { emitEventSpan, initOtel, otelEnabled } from "../util/otel.js";
import { watchTriggers } from "../util/triggers.js";
import {
  detectStuckLoop,
  scoreEvent,
  summarizeBySession,
  type AnomalyFlag,
} from "../util/anomaly.js";
import { searchAllSessions, type SearchHit } from "../util/cross-search.js";
import { CrossSearchView } from "./CrossSearchView.js";
import { notify, shouldNotify } from "../util/notifier.js";
import { HelpView } from "./HelpView.js";
import { Breadcrumb } from "./Breadcrumb.js";
import { detectAgents } from "../adapters/detect.js";
import {
  startAllAdapters,
  stopAllAdapters,
} from "../adapters/registry.js";
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
  /** Projects-picker view state */
  projectsOpen: boolean;
  projectsSelectedIdx: number;
  /** Current project filter applied to the timeline */
  projectFilter: string | null;
  /** Scroll offset for the permissions view */
  permissionsScroll: number;
  /** Sessions-list view: project name when open, null when closed */
  sessionsForProject: string | null;
  sessionsSelectedIdx: number;
  sessionsScroll: number;
  /** Scoped session filter (timeline shows only this sessionId) */
  sessionFilter: string | null;
  /** Transient message shown at the footer for ~2s (e.g. after a yank). */
  flashMessage: string | null;
  showHelp: boolean;
  /** Token-attribution overlay for the currently scoped session. */
  showTokens: boolean;
  /** Cross-session search view state. */
  crossSearchOpen: boolean;
  crossSearchQuery: string;
  crossSearchTyping: boolean;
  crossSearchResults: SearchHit[];
  crossSearchIdx: number;
  /** Anomaly banner dismissal — keyed by a signature of current anomalies
   *  so re-flagging a different anomaly reopens the banner. */
  anomalyDismissKey: string | null;
  /** Event IDs we have already fired desktop notifications for (per
   *  process lifetime). */
  anomalyNotified: Set<string>;
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
  | { type: "confirm-search" }
  | { type: "search-input"; char: string }
  | { type: "search-backspace" }
  | { type: "scope-subagent"; subAgentId: string }
  | { type: "unscope-subagent" }
  | { type: "toggle-projects" }
  | { type: "projects-move"; delta: number; max: number }
  | { type: "projects-select"; name: string }
  | { type: "set-project-filter"; project: string | null }
  | { type: "scroll-permissions"; delta: number; max: number }
  | { type: "flash"; text: string }
  | { type: "flash-clear" }
  | { type: "toggle-help" }
  | { type: "toggle-tokens" }
  | { type: "cross-open" }
  | { type: "cross-close" }
  | { type: "cross-type"; char: string }
  | { type: "cross-backspace" }
  | { type: "cross-submit"; hits: SearchHit[] }
  | { type: "cross-move"; delta: number }
  | { type: "anomaly-dismiss"; key: string }
  | { type: "anomaly-mark-notified"; ids: string[] }
  | { type: "home" }
  | { type: "back" }
  | { type: "open-sessions"; project: string }
  | { type: "close-sessions" }
  | { type: "sessions-move"; delta: number; max: number }
  | { type: "sessions-scroll"; delta: number; max: number }
  | { type: "sessions-open-selected"; sessionId: string }
  | { type: "clear-filters" };

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
      return {
        ...state,
        showPermissions: !state.showPermissions,
        permissionsScroll: 0,
      };
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
    case "confirm-search":
      // Exit input mode but keep the query as a sticky filter.
      return { ...state, searchOpen: false };
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
    case "toggle-projects":
      return {
        ...state,
        projectsOpen: !state.projectsOpen,
        projectsSelectedIdx: 0,
        detailOpen: false,
        showPermissions: false,
      };
    case "projects-move": {
      if (action.max <= 0) return state;
      const next = Math.max(
        0,
        Math.min(action.max - 1, state.projectsSelectedIdx + action.delta),
      );
      return { ...state, projectsSelectedIdx: next };
    }
    case "projects-select":
      return {
        ...state,
        sessionsForProject: action.name,
        sessionsSelectedIdx: 0,
        sessionsScroll: 0,
        projectsOpen: false,
      };
    case "set-project-filter":
      return { ...state, projectFilter: action.project, selectedIdx: null };
    case "scroll-permissions": {
      const next = Math.max(0, Math.min(action.max, state.permissionsScroll + action.delta));
      return { ...state, permissionsScroll: next };
    }
    case "open-sessions":
      return {
        ...state,
        sessionsForProject: action.project,
        sessionsSelectedIdx: 0,
        sessionsScroll: 0,
      };
    case "close-sessions":
      return { ...state, sessionsForProject: null };
    case "sessions-move": {
      if (action.max <= 0) return state;
      const next = Math.max(
        0,
        Math.min(action.max - 1, state.sessionsSelectedIdx + action.delta),
      );
      return { ...state, sessionsSelectedIdx: next };
    }
    case "sessions-scroll": {
      const next = Math.max(0, Math.min(action.max, state.sessionsScroll + action.delta));
      return { ...state, sessionsScroll: next };
    }
    case "sessions-open-selected":
      return {
        ...state,
        sessionFilter: action.sessionId,
        sessionsForProject: null,
        selectedIdx: null,
      };
    case "flash":
      return { ...state, flashMessage: action.text };
    case "flash-clear":
      return { ...state, flashMessage: null };
    case "toggle-help":
      return { ...state, showHelp: !state.showHelp };
    case "toggle-tokens":
      return { ...state, showTokens: !state.showTokens };
    case "cross-open":
      return {
        ...state,
        crossSearchOpen: true,
        crossSearchTyping: true,
        crossSearchQuery: "",
        crossSearchResults: [],
        crossSearchIdx: 0,
      };
    case "cross-close":
      return {
        ...state,
        crossSearchOpen: false,
        crossSearchTyping: false,
        crossSearchQuery: "",
        crossSearchResults: [],
      };
    case "cross-type":
      return { ...state, crossSearchQuery: state.crossSearchQuery + action.char };
    case "cross-backspace":
      return {
        ...state,
        crossSearchQuery: state.crossSearchQuery.slice(0, -1),
      };
    case "cross-submit":
      return {
        ...state,
        crossSearchTyping: false,
        crossSearchResults: action.hits,
        crossSearchIdx: 0,
      };
    case "cross-move": {
      const max = Math.max(1, state.crossSearchResults.length);
      const next = Math.max(
        0,
        Math.min(max - 1, state.crossSearchIdx + action.delta),
      );
      return { ...state, crossSearchIdx: next };
    }
    case "anomaly-dismiss":
      return { ...state, anomalyDismissKey: action.key };
    case "anomaly-mark-notified": {
      const next = new Set(state.anomalyNotified);
      for (const id of action.ids) next.add(id);
      return { ...state, anomalyNotified: next };
    }
    case "home":
      // Reset every view / filter / scope back to the default timeline
      return {
        ...state,
        showHelp: false,
        showPermissions: false,
        detailOpen: false,
        projectsOpen: false,
        sessionsForProject: null,
        projectFilter: null,
        sessionFilter: null,
        subAgentScope: null,
        filterAgent: null,
        searchQuery: "",
        searchOpen: false,
        selectedIdx: null,
        detailScroll: 0,
        permissionsScroll: 0,
        sessionsScroll: 0,
      };
    case "clear-filters":
      return {
        ...state,
        projectFilter: null,
        sessionFilter: null,
        subAgentScope: null,
        filterAgent: null,
        searchQuery: "",
        selectedIdx: null,
      };
    case "back": {
      // esc semantics: close the deepest active modal / scope
      if (state.showHelp) return { ...state, showHelp: false };
      if (state.detailOpen) return { ...state, detailOpen: false, detailScroll: 0 };
      if (state.showPermissions)
        return { ...state, showPermissions: false, permissionsScroll: 0 };
      if (state.sessionsForProject)
        return { ...state, sessionsForProject: null, projectsOpen: true };
      if (state.projectsOpen) return { ...state, projectsOpen: false };
      if (state.subAgentScope)
        return { ...state, subAgentScope: null, selectedIdx: null };
      if (state.sessionFilter)
        return { ...state, sessionFilter: null, selectedIdx: null };
      if (state.projectFilter)
        return { ...state, projectFilter: null, selectedIdx: null };
      if (state.filterAgent)
        return { ...state, filterAgent: null, selectedIdx: null };
      if (state.searchQuery)
        return { ...state, searchQuery: "", selectedIdx: null };
      if (state.selectedIdx !== null) return { ...state, selectedIdx: null };
      return state;
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
    projectsOpen: false,
    projectsSelectedIdx: 0,
    projectFilter: null,
    permissionsScroll: 0,
    sessionsForProject: null,
    sessionsSelectedIdx: 0,
    sessionsScroll: 0,
    sessionFilter: null,
    flashMessage: null,
    showHelp: false,
    showTokens: false,
    crossSearchOpen: false,
    crossSearchQuery: "",
    crossSearchTyping: false,
    crossSearchResults: [],
    crossSearchIdx: 0,
    anomalyDismissKey: null,
    anomalyNotified: new Set<string>(),
  });

  useEffect(() => {
    const stopTriggersWatch = watchTriggers();
    if (otelEnabled()) void initOtel();
    const launchedAt = Date.now();
    const sink: EventSink = {
      emit: (e: AgentEvent) => {
        dispatch({ type: "event", event: e });
        emitEventSpan(e);
        const eventMs = new Date(e.ts).getTime();
        if (eventMs < launchedAt) return;
        const alert = shouldNotify(e);
        if (alert) notify(alert.title, alert.body);
      },
      enrich: (eventId: string, patch: Partial<EventDetails>) => {
        dispatch({ type: "enrich", eventId, patch });
      },
    };
    const adapters = startAllAdapters(sink, workspace);
    const cursorAdapter = adapters.find((a) => a.name === "cursor");
    if (cursorAdapter?.status) setCursorStatus(cursorAdapter.status);
    return () => {
      stopAllAdapters(adapters);
      stopTriggersWatch();
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
  const projectScoped = state.projectFilter
    ? scoped.filter((e) =>
        (e.summary ?? "").startsWith(`[${state.projectFilter}`),
      )
    : scoped;
  const sessionScoped = state.sessionFilter
    ? projectScoped.filter((e) => e.sessionId === state.sessionFilter)
    : projectScoped;
  const filtered = state.searchQuery
    ? sessionScoped.filter((e) => matchesQuery(e, state.searchQuery))
    : sessionScoped;

  const budgetStatus = computeBudgetStatus(state.events);

  // Anomaly pass — score only the most recent 40 events against their
  // per-agent history. Anything older is effectively static and
  // re-scoring it is wasted work.
  const anomalies = new Map<string, AnomalyFlag[]>();
  {
    const sliceEnd = Math.min(40, state.events.length);
    // Events are newest-first; score the newest batch.
    for (let i = 0; i < sliceEnd; i++) {
      const ev = state.events[i]!;
      const history = state.events
        .slice(i + 1)
        .filter((h) => h.agent === ev.agent);
      if (history.length === 0) continue;
      const flags = scoreEvent(ev, history);
      if (flags.length > 0) anomalies.set(ev.id, flags);
    }
  }
  const stuckLoop = detectStuckLoop(state.events.slice(0, 20).reverse());
  if (stuckLoop) {
    const first = state.events[0];
    if (first) {
      const prev = anomalies.get(first.id) ?? [];
      const label =
        stuckLoop.period === 1
          ? `same tool fired ${stuckLoop.count}× in a row`
          : `period-${stuckLoop.period} loop (${stuckLoop.count} cycles): ${stuckLoop.pattern}`;
      anomalies.set(first.id, [
        ...prev,
        {
          kind: "stuck-loop",
          message: `stuck loop: ${label}`,
          magnitude: stuckLoop.count,
          sessionId: first.sessionId,
        },
      ]);
    }
  }

  // Fire OS notifications the first time a budget is breached this run.
  const budgetBreachKey = [
    budgetStatus.breachedSession ?? "",
    budgetStatus.dayBreach ? "day" : "",
  ].join("|");
  useEffect(() => {
    if (!budgetStatus.breachedSession && !budgetStatus.dayBreach) return;
    if (budgetStatus.breachedSession && budgetStatus.perSessionUsd != null) {
      notify(
        "⚠ agentwatch — session budget breached",
        `session ${budgetStatus.breachedSession.slice(0, 8)} $${budgetStatus.sessionCost.toFixed(4)} > cap $${budgetStatus.perSessionUsd.toFixed(2)}`,
      );
    }
    if (budgetStatus.dayBreach && budgetStatus.perDayUsd != null) {
      notify(
        "⚠ agentwatch — daily budget breached",
        `today $${budgetStatus.dayCost.toFixed(4)} > cap $${budgetStatus.perDayUsd.toFixed(2)}`,
      );
    }
  }, [budgetBreachKey]);

  // Aggregate per session + fire OS notifications for new anomalies.
  const sessionSummaries = summarizeBySession(anomalies);
  const anomalyKey = sessionSummaries
    .map((s) => `${s.sessionId}:${s.headline}`)
    .join("|");
  const bannerSuppressed = state.anomalyDismissKey === anomalyKey;
  useEffect(() => {
    const toNotify: string[] = [];
    for (const [id, flags] of anomalies) {
      if (state.anomalyNotified.has(id)) continue;
      for (const f of flags) {
        notify(
          `⚠ agentwatch anomaly`,
          `${f.kind}: ${f.message}`,
        );
        toNotify.push(id);
        break;
      }
    }
    if (toNotify.length > 0) {
      dispatch({ type: "anomaly-mark-notified", ids: toNotify });
    }
  }, [anomalyKey]);

  const projects = buildProjectIndex(state.events);
  const sessionsForOpen = state.sessionsForProject
    ? buildSessionRows(state.events, state.sessionsForProject)
    : [];

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
  const tooNarrow = cols < 60;
  const tooShort = rows < 12;
  const selectedEvent =
    state.selectedIdx !== null ? filtered[state.selectedIdx] : undefined;
  const detailRowCount = selectedEvent
    ? totalDetailRows(selectedEvent, cols - 6)
    : 0;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      restoreTerminal();
      setImmediate(() => process.exit(0));
      return;
    }

    // Cross-session search overlay: its own input loop
    if (state.crossSearchOpen) {
      if (key.escape) {
        dispatch({ type: "cross-close" });
        return;
      }
      if (state.crossSearchTyping) {
        if (key.return) {
          const hits = searchAllSessions(state.crossSearchQuery, 100);
          dispatch({ type: "cross-submit", hits });
          return;
        }
        if (key.backspace || key.delete) {
          dispatch({ type: "cross-backspace" });
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          dispatch({ type: "cross-type", char: input });
          return;
        }
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({ type: "cross-move", delta: 1 });
        return;
      }
      if (key.upArrow || input === "k") {
        dispatch({ type: "cross-move", delta: -1 });
        return;
      }
      if (key.return) {
        const hit = state.crossSearchResults[state.crossSearchIdx];
        if (hit) {
          dispatch({ type: "cross-close" });
          dispatch({
            type: "sessions-open-selected",
            sessionId: hit.sessionId,
          });
        }
        return;
      }
      return;
    }

    // Search-input mode: capture typing into the query buffer
    if (state.searchOpen) {
      if (key.escape) {
        dispatch({ type: "close-search" });
        return;
      }
      if (key.return) {
        dispatch({ type: "confirm-search" });
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
      restoreTerminal();
      setImmediate(() => process.exit(0));
      return;
    }

    if (state.projectsOpen) {
      if (key.escape) {
        dispatch({ type: "back" });
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({ type: "projects-move", delta: 1, max: projects.length });
        return;
      }
      if (key.upArrow || input === "k") {
        dispatch({ type: "projects-move", delta: -1, max: projects.length });
        return;
      }
      if (key.return) {
        const p = projects[state.projectsSelectedIdx];
        if (p) dispatch({ type: "projects-select", name: p.name });
        return;
      }
      return;
    }

    if (state.sessionsForProject) {
      const lineCount = sessionLineCount(sessionsForOpen);
      const viewport = Math.max(3, rows - 8);
      const maxScroll = Math.max(0, lineCount - viewport);
      if (key.escape) {
        dispatch({ type: "back" });
        return;
      }
      if (input === "e") {
        const s = sessionsForOpen[state.sessionsSelectedIdx];
        if (s) {
          const sessionEvents = state.events.filter(
            (e) => e.sessionId === s.sessionId,
          );
          const res = exportSession(sessionEvents, s.sessionId, s.agent);
          const copy = copyToClipboard(res.mdPath);
          const msg = copy.ok
            ? `✓ exported → ${res.mdPath} (path copied)`
            : `✓ exported → ${res.mdPath}`;
          dispatch({ type: "flash", text: msg });
          setTimeout(() => dispatch({ type: "flash-clear" }), 3000);
        }
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({
          type: "sessions-move",
          delta: 1,
          max: sessionsForOpen.length,
        });
        dispatch({ type: "sessions-scroll", delta: 1, max: maxScroll });
        return;
      }
      if (key.upArrow || input === "k") {
        dispatch({
          type: "sessions-move",
          delta: -1,
          max: sessionsForOpen.length,
        });
        dispatch({ type: "sessions-scroll", delta: -1, max: maxScroll });
        return;
      }
      if (key.return) {
        const s = sessionsForOpen[state.sessionsSelectedIdx];
        if (s)
          dispatch({ type: "sessions-open-selected", sessionId: s.sessionId });
        return;
      }
      return;
    }

    if (state.showPermissions) {
      const total = permissionRowCount(claudePerms, cursorStatus, openclawCfg);
      const viewport = Math.max(3, rows - 8);
      const maxScroll = Math.max(0, total - viewport);
      if (key.escape || input === "p") {
        dispatch({ type: "back" });
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({ type: "scroll-permissions", delta: 1, max: maxScroll });
        return;
      }
      if (key.upArrow || input === "k") {
        dispatch({ type: "scroll-permissions", delta: -1, max: maxScroll });
        return;
      }
      // Also let q quit from the permissions screen
      return;
    }

    if (state.detailOpen) {
      if (key.escape) {
        dispatch({ type: "back" });
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
    if (input === "?") dispatch({ type: "cross-open" });
    if (input === "D" && anomalyKey) {
      dispatch({ type: "anomaly-dismiss", key: anomalyKey });
    }
    if (input === "x" && state.selectedIdx !== null) {
      const ev = filtered[state.selectedIdx];
      const sid = ev?.details?.subAgentId;
      if (sid) dispatch({ type: "scope-subagent", subAgentId: sid });
    }
    if (input === "X") dispatch({ type: "unscope-subagent" });
    if (input === "y" && state.selectedIdx !== null) {
      const ev = filtered[state.selectedIdx];
      if (ev) {
        const text = eventToYankText(
          ev.summary,
          ev.path,
          ev.cmd,
          ev.details?.toolResult,
          ev.details?.fullText,
        );
        if (text) {
          const res = copyToClipboard(text);
          const message = res.ok
            ? `✓ copied ${text.length} chars to clipboard`
            : `✗ ${res.reason}`;
          dispatch({ type: "flash", text: message });
          setTimeout(() => dispatch({ type: "flash-clear" }), 2000);
        }
      }
    }
    if (input === "e" && state.sessionFilter) {
      const sessionEvents = state.events.filter(
        (ev) => ev.sessionId === state.sessionFilter,
      );
      const agent = sessionEvents[0]?.agent ?? "unknown";
      const res = exportSession(sessionEvents, state.sessionFilter, agent);
      const copy = copyToClipboard(res.mdPath);
      const msg = copy.ok
        ? `✓ exported → ${res.mdPath} (path copied)`
        : `✓ exported → ${res.mdPath}`;
      dispatch({ type: "flash", text: msg });
      setTimeout(() => dispatch({ type: "flash-clear" }), 3000);
    }
    if (input === "t" && state.sessionFilter) {
      dispatch({ type: "toggle-tokens" });
    }
    if (input === "P") dispatch({ type: "toggle-projects" });
    if (input === "A") {
      dispatch({ type: "set-project-filter", project: null });
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
    if (key.escape) dispatch({ type: "back" });
  });

  if (tooNarrow || tooShort) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow" bold>
          Terminal too small for the agentwatch TUI
        </Text>
        <Text>Detected: {cols} cols × {rows} rows</Text>
        <Text>Minimum: 60 cols × 12 rows</Text>
        <Text> </Text>
        <Text dimColor>Resize the window and restart, or run `agentwatch doctor` for a compact view.</Text>
        <Text dimColor>Press q to quit.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header
        workspace={workspace}
        eventCount={state.events.length}
        filter={state.filterAgent}
        paused={state.paused}
        budget={budgetStatus}
        anomalies={bannerSuppressed ? undefined : anomalies}
        sessionAnomalies={bannerSuppressed ? [] : sessionSummaries}
      />
      <Breadcrumb
        projectFilter={state.projectFilter}
        sessionFilter={state.sessionFilter}
        sessionsForProject={state.sessionsForProject}
        subAgentScope={state.subAgentScope}
        agentFilter={state.filterAgent}
        searchQuery={state.searchQuery}
        view={
          state.showHelp
            ? "help"
            : state.detailOpen
              ? "detail"
              : state.showPermissions
                ? "permissions"
                : state.sessionsForProject
                  ? "sessions"
                  : state.projectsOpen
                    ? "projects"
                    : "timeline"
        }
      />
      {state.showHelp ? (
        <HelpView />
      ) : state.crossSearchOpen ? (
        <CrossSearchView
          query={state.crossSearchQuery}
          hits={state.crossSearchResults}
          selectedIdx={state.crossSearchIdx}
          viewportRows={Math.max(3, rows - 8)}
        />
      ) : state.showTokens && state.sessionFilter ? (
        <TokensView
          breakdown={attributeTokens(state.events, state.sessionFilter)}
          sessionId={state.sessionFilter}
        />
      ) : state.sessionsForProject ? (
        <SessionsView
          project={state.sessionsForProject}
          sessions={sessionsForOpen}
          selectedIdx={state.sessionsSelectedIdx}
          viewportRows={Math.max(3, rows - 8)}
          scrollOffset={state.sessionsScroll}
        />
      ) : state.projectsOpen ? (
        <ProjectsView
          projects={projects}
          selectedIdx={state.projectsSelectedIdx}
          searchQuery={state.searchQuery}
        />
      ) : state.detailOpen && selectedEvent ? (
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
          viewportRows={Math.max(3, rows - 8)}
          scrollOffset={state.permissionsScroll}
        />
      ) : (
        <Box flexDirection="row">
          <Box flexGrow={1} flexDirection="column">
            <Timeline
              events={filtered}
              selectedIdx={state.selectedIdx}
              childCountByAgentId={childCountByAgentId}
              anomalies={anomalies}
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
        {state.flashMessage && (
          <Text color={state.flashMessage.startsWith("✓") ? "green" : "red"}>
            {state.flashMessage}
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
            : state.sessionsForProject
              ? "[↑↓] select  [enter] open  [e] export  [esc] back"
              : state.projectsOpen
                ? "[↑↓] select project  [enter] sessions  [esc] close"
                : state.detailOpen
                ? "[esc] close  [↑↓] scroll"
                : `[?] help  [q] quit  [esc] back  [↑↓] select  [enter] detail  [/] search  [P] projects  [p] permissions  [e] export${state.sessionFilter ? "  [t] tokens" : ""}  [Z] clear filters`}
        </Text>
      </Box>
    </Box>
  );
}
