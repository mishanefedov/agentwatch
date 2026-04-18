import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Clock, Heart, Calendar } from "lucide-react";

export function CronPage() {
  const q = useQuery({ queryKey: ["cron"], queryFn: api.cron, refetchInterval: 10_000 });
  if (q.isLoading) return <div className="p-6 text-fg-dim">loading…</div>;
  const jobs = q.data?.jobs ?? [];
  const heartbeats = q.data?.heartbeats ?? [];
  const scheduledEvents = q.data?.scheduledEvents ?? [];

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Clock className="w-5 h-5 text-accent" />
        <h1 className="text-lg font-bold">scheduled</h1>
      </div>

      <section className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-accent" />
          <h2 className="font-bold">cron jobs</h2>
          <span className="text-xs text-fg-dim">{jobs.length}</span>
        </div>
        {jobs.length === 0 && <div className="text-sm text-fg-dim">No OpenClaw cron jobs installed.</div>}
        {jobs.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-fg-muted">
              <tr>
                <th className="py-1 pr-4">name</th>
                <th className="py-1 pr-4">schedule</th>
                <th className="py-1 pr-4">agent</th>
                <th className="py-1 pr-4">channel</th>
                <th className="py-1">last run</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j: any) => (
                <tr key={j.id} className="border-b border-bg-border/30 mono text-xs">
                  <td className="py-1.5 pr-4">{j.name ?? j.id}</td>
                  <td className="py-1.5 pr-4 text-fg-dim">{j.cron ?? j.schedule ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-fg-dim">{j.agentId ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-fg-dim">{j.channel ?? "—"}</td>
                  <td className="py-1.5 text-fg-dim">{j.lastRunAt ? formatDateTime(j.lastRunAt) : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="p-5 border-t border-bg-border">
        <div className="flex items-center gap-2 mb-3">
          <Heart className="w-4 h-4 text-accent" />
          <h2 className="font-bold">heartbeats</h2>
          <span className="text-xs text-fg-dim">{heartbeats.length}</span>
        </div>
        {heartbeats.length === 0 && <div className="text-sm text-fg-dim">No heartbeat tasks detected.</div>}
        {heartbeats.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-fg-muted">
              <tr>
                <th className="py-1 pr-4">task</th>
                <th className="py-1 pr-4">agent</th>
                <th className="py-1 pr-4">last</th>
                <th className="py-1">file</th>
              </tr>
            </thead>
            <tbody>
              {heartbeats.map((h: any, i: number) => (
                <tr key={i} className="border-b border-bg-border/30 mono text-xs">
                  <td className="py-1.5 pr-4">{h.taskName ?? h.name ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-fg-dim">{h.agentId ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-fg-dim">{h.lastHeartbeatAt ? formatDateTime(h.lastHeartbeatAt) : "—"}</td>
                  <td className="py-1.5 text-fg-dim truncate max-w-md">{h.filePath ?? h.file ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="p-5 border-t border-bg-border">
        <h2 className="font-bold mb-3">recent scheduled events <span className="text-xs font-normal text-fg-dim">{scheduledEvents.length}</span></h2>
        {scheduledEvents.length === 0 && <div className="text-sm text-fg-dim">No scheduled events in the live buffer.</div>}
        {scheduledEvents.slice(0, 50).map((e: any) => (
          <div key={e.id} className="mono text-xs py-1 border-b border-bg-border/20">
            <span className="text-fg-dim mr-2">{formatDateTime(e.ts)}</span>
            <span className="text-accent mr-2">{e.agent}</span>
            <span className="mr-2">{e.type}</span>
            <span className="text-fg-dim">{e.summary}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
