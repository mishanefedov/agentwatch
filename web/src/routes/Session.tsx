import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { agentColor, formatTime, riskClass, typeIcon } from "../lib/format";
import { ArrowLeft, Download, BarChart3, Activity, GitBranch } from "lucide-react";
import clsx from "clsx";
import type { AgentEvent } from "../lib/types";

export function SessionPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.session(id),
    refetchInterval: 2_000,
  });

  if (q.isLoading) return <div className="p-6 text-fg-dim">loading…</div>;
  if (q.error) return <div className="p-6 text-danger">{String(q.error)}</div>;

  const events: AgentEvent[] = q.data?.events ?? [];
  // Events come newest-first from the store; we want the session view
  // in chronological order (top = start of session).
  const ordered = [...events].reverse();

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={-1 as unknown as string} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold mono">session:{id.slice(0, 16)}</h1>
        <span className={clsx("text-sm", agentColor(q.data?.agent as any))}>{q.data?.agent}</span>
        <span className="text-sm text-fg-dim">{events.length} events</span>
        <div className="ml-auto flex items-center gap-3">
          <Link to={`/sessions/${encodeURIComponent(id)}/tokens`} className="text-xs text-fg-dim hover:text-accent flex items-center gap-1">
            <BarChart3 className="w-3.5 h-3.5" /> tokens
          </Link>
          <Link to={`/sessions/${encodeURIComponent(id)}/compaction`} className="text-xs text-fg-dim hover:text-accent flex items-center gap-1">
            <Activity className="w-3.5 h-3.5" /> compaction
          </Link>
          <Link to={`/sessions/${encodeURIComponent(id)}/graph`} className="text-xs text-fg-dim hover:text-accent flex items-center gap-1">
            <GitBranch className="w-3.5 h-3.5" /> graph
          </Link>
          <a
            href={`/api/sessions/${encodeURIComponent(id)}/export?format=md&inline=1`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-fg-dim hover:text-accent flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" /> .md
          </a>
          <a
            href={`/api/sessions/${encodeURIComponent(id)}/export?format=json&inline=1`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-fg-dim hover:text-accent flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" /> .json
          </a>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {ordered.map((e) => (
          <SessionEventRow key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}

function SessionEventRow({ event }: { event: AgentEvent }) {
  const body = event.details?.fullText ?? event.details?.toolResult ?? event.details?.thinking;
  return (
    <div className="px-5 py-2 border-b border-bg-border/30 hover:bg-bg-surface/40">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-muted mono">{formatTime(event.ts)}</span>
        <span className={clsx("mono", agentColor(event.agent))}>{event.agent}</span>
        <span className="mono text-fg-dim">
          {typeIcon(event.type)} {event.type}
        </span>
        <span className={clsx("text-[10px] mono px-1.5 rounded", riskClass(event.riskScore))}>
          {event.riskScore}
        </span>
        <Link to={`/events/${encodeURIComponent(event.id)}`} className="ml-auto text-fg-muted hover:text-accent text-[11px]">
          detail →
        </Link>
      </div>
      {event.summary && <div className="mt-1 text-sm mono whitespace-pre-wrap">{event.summary}</div>}
      {body && (
        <pre className="mt-1 text-xs mono text-fg-dim bg-bg-surface rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
          {body.slice(0, 2000)}
          {body.length > 2000 && `… (${body.length - 2000} more chars)`}
        </pre>
      )}
    </div>
  );
}
