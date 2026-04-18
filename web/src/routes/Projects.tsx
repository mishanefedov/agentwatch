import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatUSD, formatDateTime } from "../lib/format";
import { Folder, ArrowRight } from "lucide-react";

export function ProjectsPage() {
  const q = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
    refetchInterval: 5_000,
  });

  if (q.isLoading) return <div className="p-6 text-fg-dim">loading…</div>;
  if (q.error) return <div className="p-6 text-danger">failed: {String(q.error)}</div>;

  const projects = q.data?.projects ?? [];

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <h1 className="text-lg font-bold">Projects</h1>
        <span className="text-sm text-fg-dim">{projects.length}</span>
      </div>
      {projects.length === 0 ? (
        <div className="p-10 text-center text-fg-dim">
          No projects detected yet — once an agent writes to a project, it'll appear here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-5">
          {projects.map((p) => (
            <Link
              to={`/projects/${encodeURIComponent(p.name)}`}
              key={p.name}
              className="block border border-bg-border rounded-lg p-4 bg-bg-surface hover:bg-bg-elev hover:border-accent/40 transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Folder className="w-4 h-4 text-accent shrink-0" />
                  <div className="font-medium truncate">{p.name}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-fg-muted" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Stat label="events" value={String(p.eventCount)} />
                <Stat label="sessions" value={String(p.sessionIds.length)} />
                <Stat label="cost" value={formatUSD(p.cost)} />
              </div>
              {p.lastTs && (
                <div className="mt-2 text-[11px] text-fg-muted mono">last: {formatDateTime(p.lastTs)}</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elev rounded-md px-2 py-1.5">
      <div className="text-[10px] uppercase text-fg-muted">{label}</div>
      <div className="mono">{value}</div>
    </div>
  );
}
