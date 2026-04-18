import React from "react";
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
import { SessionTokensPage } from "./routes/SessionTokens";
import { SessionCompactionPage } from "./routes/SessionCompaction";
import { SessionGraphPage } from "./routes/SessionGraph";
import { PermissionsPage } from "./routes/Permissions";
import { CronPage } from "./routes/Cron";
import { AgentsPage } from "./routes/Agents";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 2_000 },
  },
});

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
            <Route path="sessions/:id/tokens" element={<SessionTokensPage />} />
            <Route path="sessions/:id/compaction" element={<SessionCompactionPage />} />
            <Route path="sessions/:id/graph" element={<SessionGraphPage />} />
            <Route path="events/:id" element={<EventDetailPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="permissions" element={<PermissionsPage />} />
            <Route path="cron" element={<CronPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
