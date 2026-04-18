import { useEffect, useMemo, useReducer, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { AgentEvent, AgentName, EventDetails, EventSink } from "../schema.js";
import { Timeline } from "./Timeline.js";
import { AgentPanel } from "./AgentPanel.js";
import { Header } from "./Header.js";
import { Breadcrumb } from "./Breadcrumb.js";
import { restoreTerminal } from "../util/terminal.js";
import { computeBudgetStatus } from "../util/budgets.js";
import { emitEventSpan, initOtel, otelEnabled } from "../util/otel.js";
import { watchTriggers } from "../util/triggers.js";
import {
  detectStuckLoop,
  scoreEvent,
  summarizeBySession,
  type AnomalyFlag,
} from "../util/anomaly.js";
import { notify, shouldNotify } from "../util/notifier.js";
import { detectAgents } from "../adapters/detect.js";
import {
  startAllAdapters,
  stopAllAdapters,
} from "../adapters/registry.js";
import { detectWorkspaceRoot } from "../util/workspace.js";
import { initialState, matchesQuery, reducer } from "./state.js";
import { startServer, type ServerHandle, addEventToServer } from "../server/index.js";
import { openUrl } from "../util/open-url.js";

/**
 * agentwatch TUI — live log tail.
 *
 * Since v0.0.4 the TUI only shows the live event stream. All the
 * former "drill-down" views (sessions list, event detail, tokens,
 * compaction, call graph, permissions, scheduled, search, help) moved
 * to the web UI at `http://127.0.0.1:3456`. Press `w` to open it.
 *
 * The TUI still runs the adapters, reducer, anomaly scoring, budget
 * checks, and desktop notifications — everything "ambient." What moved
 * is the interactive navigation; browsers are just better at that.
 */
export function App() {
  const { exit } = useApp();
  const [workspace] = useState(detectWorkspaceRoot());
  const [agents] = useState(detectAgents());
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [server, setServer] = useState<ServerHandle | null>(null);
  const noWeb = process.argv.includes("--no-web");

  // Server lifecycle — started once, lives as long as the TUI does.
  useEffect(() => {
    if (noWeb) return;
    const events: AgentEvent[] = [];
    const port = Number(
      findFlag("--port") ?? process.env.AGENTWATCH_PORT ?? 3456,
    );
    const host = findFlag("--host") ?? process.env.AGENTWATCH_HOST ?? "127.0.0.1";
    let handle: ServerHandle | null = null;
    let cancelled = false;
    startServer({ host, port, events })
      .then((h) => {
        if (cancelled) {
          void h.stop();
          return;
        }
        handle = h;
        setServer(h);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[agentwatch] web server failed to start: ${String(err)}`);
      });
    return () => {
      cancelled = true;
      if (handle) void handle.stop();
    };
  }, []);

  useEffect(() => {
    const stopTriggersWatch = watchTriggers();
    if (otelEnabled()) void initOtel();
    const launchedAt = Date.now();
    // Coalesce incoming events into a single dispatch per frame.
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
        if (server) {
          // Per-agent cap so one verbose agent (claude-code emits ~50k
          // events from a few days of history) can't evict everyone
          // else. Oldest-first storage inside each bucket; routes
          // merge across buckets on read.
          addEventToServer(server, e);
          server.broadcaster.emitEvent(e);
        }
        const eventMs = new Date(e.ts).getTime();
        if (eventMs < launchedAt) return;
        const alert = shouldNotify(e);
        if (alert) notify(alert.title, alert.body);
      },
      enrich: (eventId: string, patch: Partial<EventDetails>) => {
        dispatch({ type: "enrich", eventId, patch });
        if (server) {
          for (const bucket of server.byAgent.values()) {
            const target = bucket.find((x) => x.id === eventId);
            if (target) {
              target.details = { ...(target.details ?? {}), ...patch };
              break;
            }
          }
          server.broadcaster.emitEnrich(eventId, patch);
        }
      },
    };
    const adapters = startAllAdapters(sink, workspace);
    return () => {
      flush();
      stopAllAdapters(adapters);
      stopTriggersWatch();
    };
  }, [workspace, server]);

  const agentFiltered = state.filterAgent
    ? state.events.filter((e) => e.agent === state.filterAgent)
    : state.events;
  const filtered = state.searchQuery
    ? agentFiltered.filter((e) => matchesQuery(e, state.searchQuery))
    : agentFiltered;

  // Expensive derived passes — recompute only when the buffer changes.
  const eventsRef = state.events;

  const budgetStatus = useMemo(() => computeBudgetStatus(eventsRef), [eventsRef]);

  const anomalies = useMemo(() => {
    const out = new Map<string, AnomalyFlag[]>();
    const sliceEnd = Math.min(40, eventsRef.length);
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
      const pos = agentHistory.indexOf(ev);
      const history = pos >= 0 ? agentHistory.slice(pos + 1) : agentHistory;
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

  // Budget-breach notifications (once per distinct breach).
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

  const sessionSummaries = useMemo(() => summarizeBySession(anomalies), [anomalies]);
  const anomalyKey = sessionSummaries.map((s) => `${s.sessionId}:${s.headline}`).join("|");
  const bannerSuppressed = state.anomalyDismissKey === anomalyKey;

  useEffect(() => {
    const toNotify: string[] = [];
    for (const [id, flags] of anomalies) {
      if (state.anomalyNotified.has(id)) continue;
      for (const f of flags) {
        notify(`⚠ agentwatch anomaly`, `${f.kind}: ${f.message}`);
        toNotify.push(id);
        break;
      }
    }
    if (toNotify.length > 0) {
      dispatch({ type: "anomaly-mark-notified", ids: toNotify });
    }
  }, [anomalyKey]);

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

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      restoreTerminal();
      setImmediate(() => process.exit(0));
      return;
    }
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
      }
      return;
    }
    if (input === "q") {
      exit();
      restoreTerminal();
      setImmediate(() => process.exit(0));
      return;
    }
    if (input === "w" && server) {
      openUrl(server.url);
      dispatch({ type: "flash", text: `→ opening ${server.url}` });
      setTimeout(() => dispatch({ type: "flash-clear" }), 2000);
      return;
    }
    if (input === "/") dispatch({ type: "open-search" });
    if (input === "a") dispatch({ type: "toggle-agents" });
    if (input === "f") {
      const presentAgents = agents.filter((a) => a.present).map((a) => a.name);
      const pool = presentAgents.length
        ? presentAgents
        : (["claude-code", "unknown"] as AgentName[]);
      dispatch({ type: "cycle-filter", agents: pool });
    }
    if (input === " ") dispatch({ type: "toggle-pause" });
    if (input === "c") dispatch({ type: "clear" });
    if (input === "D" && anomalyKey) {
      dispatch({ type: "anomaly-dismiss", key: anomalyKey });
    }
    if (key.downArrow || input === "j")
      dispatch({ type: "move", delta: 1, max: filtered.length });
    if (key.upArrow || input === "k")
      dispatch({ type: "move", delta: -1, max: filtered.length });
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
        <Text dimColor>
          Resize the window and restart — or just open the web UI at{" "}
          {server?.url ?? "http://127.0.0.1:3456"}.
        </Text>
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
        webUrl={server?.url}
      />
      <Breadcrumb
        projectFilter={state.projectFilter}
        sessionFilter={state.sessionFilter}
        sessionsForProject={null}
        subAgentScope={state.subAgentScope}
        agentFilter={state.filterAgent}
        searchQuery={state.searchQuery}
        view="timeline"
      />
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
            {state.searchQuery && <Text dimColor>   matches: {filtered.length}</Text>}
          </Text>
        )}
        <Text dimColor>
          {state.searchOpen
            ? "[type to filter]  [enter] confirm  [esc] clear"
            : "[q] quit  [w] open web UI  [/] filter  [a] agents panel  [f] cycle agent filter  [space] pause  [c] clear"}
        </Text>
        <Text dimColor>All other views (projects, sessions, search, tokens, graph, settings, trends, replay, diffs) → web UI.</Text>
      </Box>
    </Box>
  );
}

function findFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const val = process.argv[idx + 1];
  return val && !val.startsWith("--") ? val : undefined;
}
