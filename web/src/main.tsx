import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "./components/Shell";
import { TimelinePage } from "./routes/Timeline";
import { ProjectsPage } from "./routes/Projects";
import { ProjectDetailPage } from "./routes/ProjectDetail";
import { SessionPage } from "./routes/Session";
import { EventDetailPage } from "./routes/EventDetail";
import { SearchPage } from "./routes/Search";
import { AgentsPage } from "./routes/Agents";
import { PermissionsPage } from "./routes/Permissions";
import { CronPage } from "./routes/Cron";
import { LogsPage } from "./routes/Logs";
import "./index.css";

// Code-split the heavy/rarely-visited pages (recharts + diff viewer +
// d3-hierarchy add most of the bundle weight). Initial route is the
// timeline — users don't pay for the chart libs until they drill in.
const SessionTokensPage = lazy(() => import("./routes/SessionTokens").then((m) => ({ default: m.SessionTokensPage })));
const SessionCompactionPage = lazy(() => import("./routes/SessionCompaction").then((m) => ({ default: m.SessionCompactionPage })));
const SessionGraphPage = lazy(() => import("./routes/SessionGraph").then((m) => ({ default: m.SessionGraphPage })));
const SessionDiffsPage = lazy(() => import("./routes/SessionDiffs").then((m) => ({ default: m.SessionDiffsPage })));
const SessionReplayPage = lazy(() => import("./routes/SessionReplay").then((m) => ({ default: m.SessionReplayPage })));
const TrendsPage = lazy(() => import("./routes/Trends").then((m) => ({ default: m.TrendsPage })));
const SettingsShell = lazy(() => import("./routes/Settings").then((m) => ({ default: m.SettingsShell })));
const BudgetsSettings = lazy(() => import("./routes/Settings").then((m) => ({ default: m.BudgetsSettings })));
const AnomalySettings = lazy(() => import("./routes/Settings").then((m) => ({ default: m.AnomalySettings })));
const TriggersSettings = lazy(() => import("./routes/Settings").then((m) => ({ default: m.TriggersSettings })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 2_000 },
  },
});

function L(node: React.ReactNode) {
  return <Suspense fallback={<div className="p-6 text-fg-dim">loading…</div>}>{node}</Suspense>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<TimelinePage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:name" element={<ProjectDetailPage />} />
            <Route path="sessions/:id" element={<SessionPage />} />
            <Route path="sessions/:id/tokens" element={L(<SessionTokensPage />)} />
            <Route path="sessions/:id/compaction" element={L(<SessionCompactionPage />)} />
            <Route path="sessions/:id/graph" element={L(<SessionGraphPage />)} />
            <Route path="sessions/:id/diffs" element={L(<SessionDiffsPage />)} />
            <Route path="sessions/:id/replay" element={L(<SessionReplayPage />)} />
            <Route path="events/:id" element={<EventDetailPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="permissions" element={<PermissionsPage />} />
            <Route path="cron" element={<CronPage />} />
            <Route path="trends" element={L(<TrendsPage />)} />
            <Route path="settings" element={L(<SettingsShell />)}>
              <Route index element={<Navigate to="budgets" replace />} />
              <Route path="budgets" element={L(<BudgetsSettings />)} />
              <Route path="anomaly" element={L(<AnomalySettings />)} />
              <Route path="triggers" element={L(<TriggersSettings />)} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
