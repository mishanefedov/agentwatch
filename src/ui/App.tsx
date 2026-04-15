import { useEffect, useMemo, useReducer, useState } from "react";
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
import { attributeTokens, attributeTurns } from "../util/token-attribution.js";
import { TokensView } from "./TokensView.js";
import { computeBudgetStatus } from "../util/budgets.js";
import { CompactionView, compactionPointCount } from "./CompactionView.js";
import { emitEventSpan, initOtel, otelEnabled } from "../util/otel.js";
import { watchTriggers } from "../util/triggers.js";
import {
  detectStuckLoop,
  scoreEvent,
  summarizeBySession,
  type AnomalyFlag,
} from "../util/anomaly.js";
import { searchAllSessions } from "../util/cross-search.js";
import {
  SearchView,
  type SearchMode,
  type UnifiedHit,
} from "./SearchView.js";
import {
  hasIndex,
  indexStats,
  loadEmbedder,
  searchBm25Only,
  searchHybrid,
} from "../util/semantic-index.js";
import { buildSemanticIndex } from "../util/semantic-builder.js";
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
import { readCodexPermissions } from "../util/codex-permissions.js";
import { readGeminiPermissions } from "../util/gemini-permissions.js";
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
  /** Compaction visualizer overlay for the currently scoped session. */
  showCompaction: boolean;
  compactionSelectedIdx: number;
  /** Selected turn within the token-attribution view. */
  tokensSelectedIdx: number;
  /** Unified search overlay. Replaces both the old `/` filter and the
   *  separate `?` cross-search. Mode tabs switch between live (in-buffer
   *  substring), cross-session (every jsonl on disk), and semantic
   *  (hybrid BM25 + embeddings). */
  searchViewOpen: boolean;
  searchMode: SearchMode;
  searchQ: string;
  searchTyping: boolean;
  searchHits: UnifiedHit[];
  searchSelectedIdx: number;
  searchStatus: string | null;
  searchConfirming: { query: string } | null;
  /** Anomaly banner dismissal — keyed by a signature of current anomalies
   *  so re-flagging a different anomaly reopens the banner. */
  anomalyDismissKey: string | null;
  /** Event IDs we have already fired desktop notifications for (per
   *  process lifetime). */
  anomalyNotified: Set<string>;
};

type Action =
  | { type: "event"; event: AgentEvent }
  | { type: "events-batch"; events: AgentEvent[] }
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
  | { type: "toggle-compaction" }
  | { type: "compaction-move"; delta: number; max: number }
  | { type: "tokens-move"; delta: number; max: number }
  | { type: "search-view-open"; mode?: SearchMode }
  | { type: "search-view-close" }
  | { type: "search-view-mode"; mode: SearchMode }
  | { type: "search-view-type"; char: string }
  | { type: "search-view-backspace" }
  | { type: "search-view-submit"; hits: UnifiedHit[] }
  | { type: "search-view-status"; status: string | null }
  | { type: "search-view-confirm-start"; query: string }
  | { type: "search-view-confirm-cancel" }
  | { type: "search-view-move"; delta: number }
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
    case "events-batch": {
      if (state.paused || action.events.length === 0) return state;
      // Merge-sort batch into the existing sorted buffer. O(n+m) rather
      // than O(m log m) dispatches + O(n²) inserts that the per-event
      // path would do during backfill.
      const merged: AgentEvent[] = [];
      const a = state.events; // newest-first
      const b = [...action.events].sort((x, y) => (x.ts < y.ts ? 1 : -1));
      let i = 0;
      let j = 0;
      while (i < a.length && j < b.length && merged.length < MAX_EVENTS) {
        if (a[i]!.ts >= b[j]!.ts) merged.push(a[i++]!);
        else merged.push(b[j++]!);
      }
      while (i < a.length && merged.length < MAX_EVENTS) merged.push(a[i++]!);
      while (j < b.length && merged.length < MAX_EVENTS) merged.push(b[j++]!);
      return { ...state, events: merged };
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
    case "toggle-compaction":
      return {
        ...state,
        showCompaction: !state.showCompaction,
        compactionSelectedIdx: 0,
      };
    case "compaction-move": {
      if (action.max <= 0) return state;
      const next = Math.max(
        0,
        Math.min(action.max - 1, state.compactionSelectedIdx + action.delta),
      );
      return { ...state, compactionSelectedIdx: next };
    }
    case "tokens-move": {
      if (action.max <= 0) return state;
      const next = Math.max(
        0,
        Math.min(action.max - 1, state.tokensSelectedIdx + action.delta),
      );
      return { ...state, tokensSelectedIdx: next };
    }
    case "search-view-open":
      return {
        ...state,
        searchViewOpen: true,
        searchMode: action.mode ?? state.searchMode,
        searchTyping: true,
        searchQ: "",
        searchHits: [],
        searchSelectedIdx: 0,
        searchStatus: null,
        searchConfirming: null,
      };
    case "search-view-close":
      return {
        ...state,
        searchViewOpen: false,
        searchTyping: false,
        searchQ: "",
        searchHits: [],
        searchStatus: null,
        searchConfirming: null,
      };
    case "search-view-mode":
      return {
        ...state,
        searchMode: action.mode,
        // Reset hits when switching mode — they are mode-specific.
        searchHits: [],
        searchSelectedIdx: 0,
        searchStatus: null,
        searchTyping: true,
      };
    case "search-view-status":
      return { ...state, searchStatus: action.status };
    case "search-view-confirm-start":
      return { ...state, searchConfirming: { query: action.query } };
    case "search-view-confirm-cancel":
      return { ...state, searchConfirming: null };
    case "search-view-type":
      return { ...state, searchQ: state.searchQ + action.char };
    case "search-view-backspace":
      return { ...state, searchQ: state.searchQ.slice(0, -1) };
    case "search-view-submit":
      return {
        ...state,
        searchTyping: false,
        searchHits: action.hits,
        searchSelectedIdx: 0,
      };
    case "search-view-move": {
      const max = Math.max(1, state.searchHits.length);
      const next = Math.max(
        0,
        Math.min(max - 1, state.searchSelectedIdx + action.delta),
      );
      return { ...state, searchSelectedIdx: next };
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
  const [codexPerms] = useState(() => readCodexPermissions());
  const [geminiPerms] = useState(() => readGeminiPermissions());
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
    searchViewOpen: false,
    searchMode: "live",
    searchQ: "",
    searchTyping: false,
    searchHits: [],
    searchSelectedIdx: 0,
    searchStatus: null,
    searchConfirming: null,
    anomalyDismissKey: null,
    anomalyNotified: new Set<string>(),
    showCompaction: false,
    compactionSelectedIdx: 0,
    tokensSelectedIdx: 0,
  });

  useEffect(() => {
    const stopTriggersWatch = watchTriggers();
    if (otelEnabled()) void initOtel();
    const launchedAt = Date.now();
    // Coalesce incoming events into a single dispatch per ~60fps frame.
    // During backfill the adapters dump hundreds of events at once;
    // without coalescing each event triggers a reducer + re-render +
    // anomaly/budget pass, freezing the TUI for several seconds.
    // With coalescing we fold them all into one O(n+m) merge.
    let pending: AgentEvent[] = [];
    let flushScheduled = false;
    const FLUSH_MS = 16;
    const flush = (): void => {
      flushScheduled = false;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      if (batch.length === 1) {
        dispatch({ type: "event", event: batch[0]! });
      } else {
        dispatch({ type: "events-batch", events: batch });
      }
    };
    const sink: EventSink = {
      emit: (e: AgentEvent) => {
        pending.push(e);
        if (!flushScheduled) {
          flushScheduled = true;
          setTimeout(flush, FLUSH_MS);
        }
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
      // Final flush so events arriving in the last 16 ms aren't dropped.
      flush();
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

  // All expensive derived passes are memoized on the event-buffer
  // identity so they only re-run when the buffer actually changes, not
  // on every keypress. This is the single biggest perf win for the TUI
  // at scale.
  const eventsRef = state.events;

  const budgetStatus = useMemo(
    () => computeBudgetStatus(eventsRef),
    [eventsRef],
  );

  // Anomaly pass — score only the most recent 40 events against their
  // per-agent history. Anything older is effectively static and
  // re-scoring it is wasted work.
  const anomalies = useMemo(() => {
    const out = new Map<string, AnomalyFlag[]>();
    const sliceEnd = Math.min(40, eventsRef.length);
    // Precompute per-agent histories once instead of slice+filter per event.
    const historyByAgent = new Map<string, AgentEvent[]>();
    for (const e of eventsRef) {
      let arr = historyByAgent.get(e.agent);
      if (!arr) {
        arr = [];
        historyByAgent.set(e.agent, arr);
      }
      arr.push(e);
    }
    for (let i = 0; i < sliceEnd; i++) {
      const ev = eventsRef[i]!;
      const agentHistory = historyByAgent.get(ev.agent) ?? [];
      // `agentHistory` is newest-first same as eventsRef; drop entries
      // at-or-before the current event.
      const pos = agentHistory.indexOf(ev);
      const history =
        pos >= 0 ? agentHistory.slice(pos + 1) : agentHistory;
      if (history.length === 0) continue;
      const flags = scoreEvent(ev, history);
      if (flags.length > 0) out.set(ev.id, flags);
    }
    const stuckLoop = detectStuckLoop(eventsRef.slice(0, 20).reverse());
    if (stuckLoop) {
      const first = eventsRef[0];
      if (first) {
        const prev = out.get(first.id) ?? [];
        const label =
          stuckLoop.period === 1
            ? `same tool fired ${stuckLoop.count}× in a row`
            : `period-${stuckLoop.period} loop (${stuckLoop.count} cycles): ${stuckLoop.pattern}`;
        out.set(first.id, [
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
    return out;
  }, [eventsRef]);

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
  const sessionSummaries = useMemo(
    () => summarizeBySession(anomalies),
    [anomalies],
  );
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

  const projects = useMemo(
    () => buildProjectIndex(eventsRef),
    [eventsRef],
  );
  const sessionsForOpen = useMemo(
    () =>
      state.sessionsForProject
        ? buildSessionRows(eventsRef, state.sessionsForProject)
        : [],
    [eventsRef, state.sessionsForProject],
  );

  // Build a parent→child count index for Agent tool_use events
  const childCountByAgentId = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of eventsRef) {
      if (e.sessionId?.startsWith("agent-")) {
        const aid = e.sessionId.slice("agent-".length);
        m.set(aid, (m.get(aid) ?? 0) + 1);
      }
    }
    return m;
  }, [eventsRef]);

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

    // Unified search overlay (live / cross-session / semantic).
    if (state.searchViewOpen) {
      // First-run semantic-index consent modal.
      if (state.searchConfirming) {
        if (input === "y" || input === "Y") {
          const q = state.searchConfirming.query;
          dispatch({ type: "search-view-confirm-cancel" });
          void runSemanticSearchUnified(q, dispatch);
          return;
        }
        if (input === "n" || input === "N" || key.escape) {
          dispatch({ type: "search-view-confirm-cancel" });
          return;
        }
        return;
      }
      if (key.escape) {
        dispatch({ type: "search-view-close" });
        return;
      }
      // Mode switching works regardless of typing/results focus.
      if (key.tab) {
        const order: SearchMode[] = ["live", "cross", "semantic"];
        const idx = order.indexOf(state.searchMode);
        const next = order[(idx + 1) % order.length]!;
        dispatch({ type: "search-view-mode", mode: next });
        return;
      }
      if (state.searchTyping) {
        // Allow 1/2/3 to switch mode only when the query is empty so
        // the digit can otherwise be typed into the query.
        if ((input === "1" || input === "2" || input === "3") && state.searchQ === "") {
          const map: Record<string, SearchMode> = {
            "1": "live",
            "2": "cross",
            "3": "semantic",
          };
          dispatch({ type: "search-view-mode", mode: map[input]! });
          return;
        }
        if (key.return) {
          const q = state.searchQ;
          runUnifiedSearch(q, state.searchMode, state.events, dispatch);
          return;
        }
        if (key.backspace || key.delete) {
          dispatch({ type: "search-view-backspace" });
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          dispatch({ type: "search-view-type", char: input });
          return;
        }
        return;
      }
      // Result-list focus.
      if (key.downArrow || input === "j") {
        dispatch({ type: "search-view-move", delta: 1 });
        return;
      }
      if (key.upArrow || input === "k") {
        dispatch({ type: "search-view-move", delta: -1 });
        return;
      }
      if (key.return) {
        const hit = state.searchHits[state.searchSelectedIdx];
        if (!hit) return;
        if (hit.kind === "live") {
          // Apply the query as a sticky filter on the main timeline.
          dispatch({ type: "search-view-close" });
          // Re-purpose the existing top-level searchQuery as the filter.
          dispatch({ type: "search-input", char: "" }); // ensure clean
        } else {
          const sid = hit.kind === "cross" ? hit.hit.sessionId : hit.hit.sessionId;
          dispatch({ type: "search-view-close" });
          dispatch({ type: "sessions-open-selected", sessionId: sid });
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
      const total = permissionRowCount(
        claudePerms,
        cursorStatus,
        openclawCfg,
        codexPerms,
        geminiPerms,
      );
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
    // Unified search overlay (live / cross-session / semantic).
    if (input === "/") dispatch({ type: "search-view-open", mode: "live" });
    // ? toggles the help overlay (the natural mnemonic).
    if (input === "?") dispatch({ type: "toggle-help" });
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
    if (input === "C" && state.sessionFilter) {
      dispatch({ type: "toggle-compaction" });
    }
    if (state.showCompaction && state.sessionFilter) {
      const max = compactionPointCount(state.events, state.sessionFilter);
      if (key.leftArrow || input === "h") {
        dispatch({ type: "compaction-move", delta: -1, max });
      }
      if (key.rightArrow || input === "l") {
        dispatch({ type: "compaction-move", delta: 1, max });
      }
    }
    if (state.showTokens && state.sessionFilter) {
      const max = attributeTurns(state.events, state.sessionFilter).length;
      if (key.downArrow) {
        dispatch({ type: "tokens-move", delta: 1, max });
      }
      if (key.upArrow) {
        dispatch({ type: "tokens-move", delta: -1, max });
      }
    }
    if (input === "0") dispatch({ type: "home" });
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
      ) : state.searchViewOpen ? (
        <SearchView
          mode={state.searchMode}
          query={state.searchQ}
          typing={state.searchTyping}
          hits={state.searchHits}
          selectedIdx={state.searchSelectedIdx}
          viewportRows={Math.max(3, rows - 8)}
          statusText={state.searchStatus}
          confirming={state.searchConfirming}
        />
      ) : state.showCompaction && state.sessionFilter ? (
        <CompactionView
          events={state.events}
          sessionId={state.sessionFilter}
          selectedIdx={state.compactionSelectedIdx}
          viewportCols={cols}
        />
      ) : state.showTokens && state.sessionFilter ? (
        <TokensView
          breakdown={attributeTokens(state.events, state.sessionFilter)}
          turns={attributeTurns(state.events, state.sessionFilter)}
          sessionId={state.sessionFilter}
          selectedIdx={state.tokensSelectedIdx}
          viewportRows={rows}
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
          codex={codexPerms}
          gemini={geminiPerms}
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
                : `[?] help  [q] quit  [0] home  [esc] back  [↑↓] select  [enter] detail  [/] search  [P] projects  [p] permissions  [e] export${state.sessionFilter ? "  [t] tokens  [C] compact" : ""}  [Z] clear filters`}
        </Text>
      </Box>
    </Box>
  );
}

/** Run the right search engine for the current mode and dispatch the
 *  results into the unified search view. Live mode is sync; cross + sem
 *  may be async. */
function runUnifiedSearch(
  query: string,
  mode: SearchMode,
  events: AgentEvent[],
  dispatch: React.Dispatch<Action>,
): void {
  if (!query) {
    dispatch({ type: "search-view-submit", hits: [] });
    dispatch({
      type: "search-view-status",
      status: "(type a query, then enter)",
    });
    return;
  }
  if (mode === "live") {
    const needle = query.toLowerCase();
    const matches = events
      .filter((e) => matchesLive(e, needle))
      .slice(0, 200)
      .map<UnifiedHit>((e) => ({ kind: "live", event: e }));
    dispatch({ type: "search-view-submit", hits: matches });
    dispatch({
      type: "search-view-status",
      status: matches.length === 0 ? "(no matches in the live buffer)" : null,
    });
    return;
  }
  if (mode === "cross") {
    const hits = searchAllSessions(query, 100).map<UnifiedHit>((h) => ({
      kind: "cross",
      hit: h,
    }));
    dispatch({ type: "search-view-submit", hits });
    dispatch({
      type: "search-view-status",
      status:
        hits.length === 0
          ? "(no matches across session files — try semantic mode for fuzzier results)"
          : null,
    });
    return;
  }
  // Semantic: gate on first-run consent.
  const needsBuild = !hasIndex() || indexStats().vectors === 0;
  if (needsBuild) {
    dispatch({ type: "search-view-confirm-start", query });
    return;
  }
  void runSemanticSearchUnified(query, dispatch);
}

function matchesLive(e: AgentEvent, needle: string): boolean {
  if ((e.summary ?? "").toLowerCase().includes(needle)) return true;
  if ((e.path ?? "").toLowerCase().includes(needle)) return true;
  if ((e.cmd ?? "").toLowerCase().includes(needle)) return true;
  if ((e.tool ?? "").toLowerCase().includes(needle)) return true;
  if ((e.agent ?? "").toLowerCase().includes(needle)) return true;
  const d = e.details;
  if (d?.fullText && d.fullText.toLowerCase().includes(needle)) return true;
  if (d?.thinking && d.thinking.toLowerCase().includes(needle)) return true;
  return false;
}

async function runSemanticSearchUnified(
  query: string,
  dispatch: React.Dispatch<Action>,
): Promise<void> {
  try {
    if (!hasIndex() || indexStats().vectors === 0) {
      dispatch({
        type: "search-view-status",
        status: "Building semantic index (first-run model download ~80MB)…",
      });
      await buildSemanticIndex({
        onProgress: (p) => {
          dispatch({
            type: "search-view-status",
            status: `Indexed ${p.embeddedTurns}/${p.queuedTurns} turns across ${p.scannedFiles} files`,
          });
        },
      });
      dispatch({ type: "search-view-status", status: "Embedding query…" });
    }
    const embed = await loadEmbedder();
    const qvec = await embed(query);
    const hits = await searchHybrid(query, new Float32Array(qvec), 50);
    dispatch({
      type: "search-view-submit",
      hits: hits.map((h) => ({ kind: "semantic" as const, hit: h })),
    });
    dispatch({
      type: "search-view-status",
      status: hits.length === 0 ? "(no semantic matches)" : null,
    });
  } catch (err) {
    dispatch({
      type: "search-view-status",
      status: `Semantic search unavailable (${String(err).slice(0, 120)}) — fell back to BM25`,
    });
    const hits = searchBm25Only(query, 50);
    dispatch({
      type: "search-view-submit",
      hits: hits.map((h) => ({ kind: "semantic" as const, hit: h })),
    });
  }
}
