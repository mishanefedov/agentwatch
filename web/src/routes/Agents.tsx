import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { agentColor, formatDateTime } from "../lib/format";
import clsx from "clsx";
import { Terminal, CheckCircle2, Circle, AlertTriangle } from "lucide-react";

export function AgentsPage() {
  const q = useQuery({ queryKey: ["agents"], queryFn: api.agents, refetchInterval: 10_000 });
  const agents = q.data?.agents ?? [];
  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Terminal className="w-5 h-5 text-accent" />
        <h1 className="text-lg font-bold">agents</h1>
        <span className="text-sm text-fg-dim">{agents.filter((a) => a.present).length} installed</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-5">
        {agents.map((a) => (
          <div
            key={a.name}
            className="bg-bg-surface border border-bg-border rounded-lg p-4"
          >
            <div className="flex items-center gap-2">
              {a.present ? (
                a.instrumented ? (
                  <CheckCircle2 className="w-4 h-4 text-ok" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-warn" />
                )
              ) : (
                <Circle className="w-4 h-4 text-fg-muted" />
              )}
              <div className={clsx("font-bold", agentColor(a.name))}>{a.label}</div>
            </div>
            <div className="mt-2 text-xs text-fg-dim mono">
              {a.present ? (a.instrumented ? "installed · events captured" : "detected · events TBD") : "not detected"}
            </div>
            {a.configPath && (
              <div className="mt-1 text-[11px] text-fg-muted mono break-all">
                {a.configPath}
              </div>
            )}
            <div className="mt-3 flex items-center gap-4 text-xs">
              <span className="text-fg-dim">events: <span className="mono">{a.eventCount}</span></span>
              {a.lastEventAt && <span className="text-fg-dim">last: <span className="mono">{formatDateTime(a.lastEventAt)}</span></span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
