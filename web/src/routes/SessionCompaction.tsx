import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatTime } from "../lib/format";
import { ArrowLeft } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer } from "recharts";

export function SessionCompactionPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["session-compaction", id],
    queryFn: () => api.sessionCompaction(id),
    refetchInterval: 3_000,
  });

  if (q.isLoading) return <div className="p-6 text-fg-dim">loading…</div>;
  const s = q.data?.series;
  if (!s) return <div className="p-6 text-fg-dim">no series data</div>;

  const chartData = s.points.map((p: any, i: number) => ({
    i,
    time: formatTime(p.ts),
    kind: p.kind,
    fill: Math.round(p.fillBefore * 100),
    fillAfter: p.fillAfter != null ? Math.round(p.fillAfter * 100) : null,
    label: p.label,
  }));

  const compactionIndexes = chartData.filter((d: any) => d.kind === "compaction");

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={`/sessions/${encodeURIComponent(id)}`} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">context / compaction</h1>
        <span className="text-sm text-fg-dim mono">{id.slice(0, 16)}</span>
      </div>
      <div className="px-5 py-4 grid grid-cols-4 gap-3 border-b border-bg-border">
        <Stat label="context window" value={s.contextWindow.toLocaleString()} />
        <Stat label="max fill" value={`${Math.round(s.maxFill * 100)}%`} />
        <Stat label="compactions" value={String(s.compactionCount)} />
        <Stat label="turns" value={String(s.points.filter((p: any) => p.kind === "turn").length)} />
      </div>

      <div className="p-5">
        <div className="text-xs uppercase text-fg-muted mb-2">context fill % over time</div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-3" style={{ height: 340 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
              <XAxis dataKey="i" stroke="#7d8590" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} stroke="#7d8590" tick={{ fontSize: 10 }} unit="%" />
              <Tooltip
                contentStyle={{ background: "#0b0d10", border: "1px solid #2b3139", fontSize: 11 }}
              />
              <Line type="monotone" dataKey="fill" stroke="#58a6ff" strokeWidth={2} dot={false} />
              {compactionIndexes.map((c: any) => (
                <ReferenceLine key={c.i} x={c.i} stroke="#f85149" strokeDasharray="3 3" />
              ))}
              <ReferenceLine y={80} stroke="#d29922" strokeDasharray="4 4" label={{ value: "80%", position: "right", fill: "#d29922", fontSize: 10 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {s.compactionCount > 0 && (
          <div className="mt-3 text-xs text-fg-dim">
            <span className="text-danger">■</span> dashed red lines = compaction points (context reset by the agent).
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-surface border border-bg-border rounded-md px-3 py-2">
      <div className="text-[10px] uppercase text-fg-muted">{label}</div>
      <div className="mono">{value}</div>
    </div>
  );
}
