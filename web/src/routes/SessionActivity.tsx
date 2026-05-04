import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatUSD } from "../lib/format";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ArrowLeft } from "lucide-react";
import type { AgentEvent } from "../lib/types";

const CATEGORY_COLORS: Record<string, string> = {
  coding: "#3fb950",
  debugging: "#f85149",
  exploration: "#58a6ff",
  planning: "#bc8cff",
  refactor: "#d29922",
  testing: "#39d353",
  docs: "#8b949e",
  chat: "#7d8590",
  config: "#e3b341",
  review: "#a371f7",
  devops: "#ff7b72",
  research: "#79c0ff",
};

function colorFor(category: string): string {
  return CATEGORY_COLORS[category] ?? "#7d8590";
}

/** Turn an ISO timestamp into a UTC minute-bucket key (YYYY-MM-DD HH:MM). */
function bucketKey(ts: string): string {
  return ts.slice(0, 16).replace("T", " ");
}

export function SessionActivityPage() {
  const { id = "" } = useParams();

  const sessionQ = useQuery({
    queryKey: ["session", id],
    queryFn: () => api.session(id),
    refetchInterval: 5_000,
  });
  const activityQ = useQuery({
    queryKey: ["session-activity", id],
    queryFn: () => api.sessionActivity(id),
    refetchInterval: 5_000,
  });

  const { chartData, categories } = useMemo(() => {
    const events: AgentEvent[] = sessionQ.data?.events ?? [];
    if (events.length === 0) return { chartData: [], categories: [] as string[] };
    const cats = new Set<string>();
    const byBucket = new Map<string, Record<string, number>>();
    for (const e of events) {
      const cat = (e.details?.category as string | undefined) ?? "chat";
      cats.add(cat);
      const k = bucketKey(e.ts);
      let row = byBucket.get(k);
      if (!row) {
        row = { _bucket: 0 } as unknown as Record<string, number>;
        byBucket.set(k, row);
      }
      row[cat] = (row[cat] ?? 0) + 1;
    }
    const ordered = Array.from(byBucket.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => ({ bucket: k, ...v }));
    return { chartData: ordered, categories: Array.from(cats).sort() };
  }, [sessionQ.data]);

  const buckets = activityQ.data?.buckets ?? [];
  const totalCost = buckets.reduce((s, b) => s + b.costUsd, 0);
  const totalEvents = buckets.reduce((s, b) => s + b.eventCount, 0);
  const isLoading = sessionQ.isLoading || activityQ.isLoading;

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={`/sessions/${encodeURIComponent(id)}`} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">activity</h1>
        <span className="text-sm text-fg-dim mono">{id.slice(0, 16)}</span>
      </div>

      {isLoading && <div className="p-6 text-fg-dim">loading…</div>}

      {!isLoading && totalEvents === 0 && (
        <div className="p-6 text-fg-dim">
          no classified events yet for this session.
        </div>
      )}

      {!isLoading && totalEvents > 0 && (
        <>
          <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-bg-border">
            <Stat label="categories" value={String(buckets.length)} />
            <Stat label="events" value={String(totalEvents)} />
            <Stat label="total cost" value={formatUSD(totalCost)} />
            <Stat
              label="span"
              value={
                chartData.length > 0
                  ? `${chartData[0]!.bucket.slice(11)} – ${chartData[chartData.length - 1]!.bucket.slice(11)}`
                  : "—"
              }
            />
          </div>

          <div className="p-5">
            <div className="text-xs uppercase text-fg-muted mb-2">
              events × category over time (1-min buckets)
            </div>
            <div
              className="bg-bg-surface border border-bg-border rounded-lg p-3"
              style={{ height: 320 }}
            >
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
                  <XAxis dataKey="bucket" stroke="#7d8590" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#7d8590" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#0b0d10",
                      border: "1px solid #2b3139",
                      fontSize: 11,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {categories.map((c) => (
                    <Bar key={c} dataKey={c} stackId="cat" fill={colorFor(c)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="px-5 pb-6">
            <div className="text-xs uppercase text-fg-muted mb-2">
              per-category summary
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-fg-muted">
                <tr>
                  <th className="py-1">category</th>
                  <th className="py-1">events</th>
                  <th className="py-1">cost</th>
                  <th className="py-1">% events</th>
                  <th className="py-1">% cost</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.category} className="mono text-xs border-b border-bg-border/30">
                    <td className="py-1.5 flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ background: colorFor(b.category) }}
                      />
                      {b.category}
                    </td>
                    <td className="py-1.5">{b.eventCount}</td>
                    <td className="py-1.5">{formatUSD(b.costUsd)}</td>
                    <td className="py-1.5 text-fg-dim">
                      {totalEvents > 0
                        ? `${((b.eventCount / totalEvents) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="py-1.5 text-fg-dim">
                      {totalCost > 0
                        ? `${((b.costUsd / totalCost) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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
