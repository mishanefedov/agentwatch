import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { agentColor, formatDateTime, formatUSD } from "../lib/format";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";

export function ProjectDetailPage() {
  const { name = "" } = useParams();
  const q = useQuery({
    queryKey: ["project-sessions", name],
    queryFn: () => api.projectSessions(name),
    refetchInterval: 5_000,
  });

  const sessions = q.data?.sessions ?? [];

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to="/projects" className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">{decodeURIComponent(name)}</h1>
        <span className="text-sm text-fg-dim">{sessions.length} sessions</span>
      </div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-bg-surface border-b border-bg-border">
          <tr className="text-left text-xs uppercase text-fg-muted">
            <th className="px-5 py-2 w-32">agent</th>
            <th className="px-2 py-2">session</th>
            <th className="px-2 py-2 w-20">events</th>
            <th className="px-2 py-2 w-24">cost</th>
            <th className="px-2 py-2 w-44">first</th>
            <th className="px-2 py-2 w-44">last</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s: any) => (
            <tr key={s.sessionId} className="border-b border-bg-border/40 row-hover">
              <td className={clsx("px-5 py-1.5 mono text-xs", agentColor(s.agent))}>{s.agent}</td>
              <td className="px-2 py-1.5 mono text-xs">
                <Link to={`/sessions/${encodeURIComponent(s.sessionId)}`} className="hover:text-accent">
                  {s.sessionId}
                </Link>
              </td>
              <td className="px-2 py-1.5 mono text-xs">{s.eventCount}</td>
              <td className="px-2 py-1.5 mono text-xs">{formatUSD(s.cost)}</td>
              <td className="px-2 py-1.5 mono text-xs text-fg-dim">{s.firstTs ? formatDateTime(s.firstTs) : "—"}</td>
              <td className="px-2 py-1.5 mono text-xs text-fg-dim">{s.lastTs ? formatDateTime(s.lastTs) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
