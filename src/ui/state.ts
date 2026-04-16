import type { AgentEvent, AgentName, EventDetails } from "../schema.js";
import type { SearchMode, UnifiedHit } from "./SearchView.js";

export const MAX_EVENTS = 500;

export function matchesQuery(e: AgentEvent, q: string): boolean {
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

export function findInsertIdx(events: AgentEvent[], ts: string): number {
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

export type State = {
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
  /** Call-graph overlay for the currently scoped session. */
  showCallGraph: boolean;
  callGraphSelectedIdx: number;
  /** Scheduled-tasks overlay (cron + heartbeat). */
  showScheduled: boolean;
  scheduledSelectedIdx: number;
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

export type Action =
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
  | { type: "toggle-call-graph" }
  | { type: "call-graph-move"; delta: number; max: number }
  | { type: "toggle-scheduled" }
  | { type: "scheduled-move"; delta: number; max: number }
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

export function initialState(): State {
  return {
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
    showCallGraph: false,
    callGraphSelectedIdx: 0,
    showScheduled: false,
    scheduledSelectedIdx: 0,
  };
}

export function reducer(state: State, action: Action): State {
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
      // than O(m log m) dispatches + O(n^2) inserts that the per-event
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
    case "toggle-call-graph":
      return {
        ...state,
        showCallGraph: !state.showCallGraph,
        callGraphSelectedIdx: 0,
      };
    case "call-graph-move": {
      if (action.max <= 0) return state;
      const next = Math.max(
        0,
        Math.min(action.max - 1, state.callGraphSelectedIdx + action.delta),
      );
      return { ...state, callGraphSelectedIdx: next };
    }
    case "toggle-scheduled":
      return {
        ...state,
        showScheduled: !state.showScheduled,
        scheduledSelectedIdx: 0,
      };
    case "scheduled-move": {
      if (action.max <= 0) return state;
      const next = Math.max(
        0,
        Math.min(action.max - 1, state.scheduledSelectedIdx + action.delta),
      );
      return { ...state, scheduledSelectedIdx: next };
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
