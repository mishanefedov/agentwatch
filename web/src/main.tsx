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
            <Route path="events/:id" element={<EventDetailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
