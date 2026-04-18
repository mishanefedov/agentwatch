import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { agentColor, formatDateTime, riskClass, typeIcon, formatUSD, formatTokens } from "../lib/format";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";

export function EventDetailPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["event", id], queryFn: () => api.event(id) });

  if (q.isLoading) return <div className="p-6 text-fg-dim">loading…</div>;
  if (q.error) return <div className="p-6 text-danger">{String(q.error)}</div>;

  const e = q.data?.event;
  if (!e) return <div className="p-6 text-danger">event not found</div>;

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={-1 as unknown as string} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">event</h1>
        <span className="text-sm text-fg-dim mono">{e.id}</span>
      </div>
      <div className="p-5 space-y-4 max-w-5xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Info label="time" value={formatDateTime(e.ts)} />
          <Info label="agent" value={<span className={agentColor(e.agent)}>{e.agent}</span>} />
          <Info label="type" value={<><span className="text-fg-muted">{typeIcon(e.type)} </span>{e.type}</>} />
          <Info label="risk" value={<span className={clsx("mono px-1.5 rounded", riskClass(e.riskScore))}>{e.riskScore}</span>} />
          {e.sessionId && (
            <Info
              label="session"
              value={
                <Link to={`/sessions/${encodeURIComponent(e.sessionId)}`} className="hover:text-accent mono text-xs">
                  {e.sessionId.slice(0, 20)}
                </Link>
              }
            />
          )}
          {e.tool && <Info label="tool" value={e.tool} />}
          {e.path && <Info label="path" value={<span className="mono text-xs">{e.path}</span>} />}
        </div>

        {e.summary && (
          <Block label="summary">
            <div className="whitespace-pre-wrap mono text-sm">{e.summary}</div>
          </Block>
        )}

        {e.cmd && (
          <Block label="cmd">
            <pre className="mono text-xs whitespace-pre-wrap">{e.cmd}</pre>
          </Block>
        )}

        {e.details?.fullText && (
          <Block label="full text">
            <pre className="mono text-xs whitespace-pre-wrap">{e.details.fullText}</pre>
          </Block>
        )}

        {e.details?.thinking && (
          <Block label="thinking">
            <pre className="mono text-xs whitespace-pre-wrap text-fg-dim">{e.details.thinking}</pre>
          </Block>
        )}

        {e.details?.toolInput && (
          <Block label="tool input">
            <pre className="mono text-xs whitespace-pre-wrap">{JSON.stringify(e.details.toolInput, null, 2)}</pre>
          </Block>
        )}

        {e.details?.toolResult && (
          <Block label={clsx("tool result", e.details.toolError && "(error)")}>
            <pre className="mono text-xs whitespace-pre-wrap">{e.details.toolResult}</pre>
          </Block>
        )}

        {e.details?.usage && (
          <Block label="usage">
            <div className="grid grid-cols-4 gap-3 text-sm">
              <Info label="input" value={formatTokens(e.details.usage.input)} />
              <Info label="output" value={formatTokens(e.details.usage.output)} />
              <Info label="cache read" value={formatTokens(e.details.usage.cacheRead)} />
              <Info label="cache create" value={formatTokens(e.details.usage.cacheCreate)} />
              {e.details.cost != null && <Info label="cost" value={formatUSD(e.details.cost)} />}
              {e.details.model && <Info label="model" value={<span className="mono text-xs">{e.details.model}</span>} />}
            </div>
          </Block>
        )}

        {e.details?.source && (
          <div className="text-xs text-fg-muted mono">source: {e.details.source}</div>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-bg-surface border border-bg-border rounded-md px-3 py-2">
      <div className="text-[10px] uppercase text-fg-muted">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function Block({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-fg-muted mb-1">{label}</div>
      <div className="bg-bg-surface border border-bg-border rounded-md p-3 overflow-x-auto">{children}</div>
    </div>
  );
}
