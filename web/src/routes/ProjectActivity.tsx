import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatUSD } from "../lib/format";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ArrowLeft } from "lucide-react";

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

export function ProjectActivityPage() {
  const { name = "" } = useParams();
  const decoded = decodeURIComponent(name);

  const q = useQuery({
    queryKey: ["project-activity", name],
    queryFn: () => api.projectActivity(name),
    refetchInterval: 5_000,
  });

  const buckets = q.data?.buckets ?? [];
  const totalEvents = buckets.reduce((s, b) => s + b.eventCount, 0);
  const totalCost = buckets.reduce((s, b) => s + b.costUsd, 0);

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={`/projects/${encodeURIComponent(decoded)}`} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">activity</h1>
        <span className="text-sm text-fg-dim mono">{decoded}</span>
      </div>

      {q.isLoading && <div className="p-6 text-fg-dim">loading…</div>}

      {!q.isLoading && totalEvents === 0 && (
        <div className="p-6 text-fg-dim">
          no classified events yet for this project.
        </div>
      )}

      {!q.isLoading && totalEvents > 0 && (
        <>
          <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-bg-border">
            <Stat label="categories" value={String(buckets.length)} />
            <Stat label="events" value={String(totalEvents)} />
            <Stat label="total cost" value={formatUSD(totalCost)} />
            <Stat
              label="sessions"
              value={String(
                buckets.reduce(
                  (s, b) => s + (b.sessionsTouched ?? 0),
                  0,
                ),
              )}
            />
          </div>

          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase text-fg-muted mb-2">
                events by category
              </div>
              <div
                className="bg-bg-surface border border-bg-border rounded-lg p-3"
                style={{ height: 300 }}
              >
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={buckets}
                      dataKey="eventCount"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={(p: { name?: string; percent?: number }) =>
                        `${p.name ?? ""} ${p.percent != null ? `${(p.percent * 100).toFixed(0)}%` : ""}`
                      }
                    >
                      {buckets.map((b) => (
                        <Cell key={b.category} fill={colorFor(b.category)} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#0b0d10",
                        border: "1px solid #2b3139",
                        fontSize: 11,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <div className="text-xs uppercase text-fg-muted mb-2">
                cost by category
              </div>
              <div
                className="bg-bg-surface border border-bg-border rounded-lg p-3"
                style={{ height: 300 }}
              >
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={buckets.filter((b) => b.costUsd > 0)}
                      dataKey="costUsd"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={(p: { name?: string; percent?: number }) =>
                        `${p.name ?? ""} ${p.percent != null ? `${(p.percent * 100).toFixed(0)}%` : ""}`
                      }
                    >
                      {buckets
                        .filter((b) => b.costUsd > 0)
                        .map((b) => (
                          <Cell key={b.category} fill={colorFor(b.category)} />
                        ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#0b0d10",
                        border: "1px solid #2b3139",
                        fontSize: 11,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="px-5 pb-6">
            <div className="text-xs uppercase text-fg-muted mb-2">
              per-category breakdown
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-fg-muted">
                <tr>
                  <th className="py-1">category</th>
                  <th className="py-1">events</th>
                  <th className="py-1">cost</th>
                  <th className="py-1">sessions touched</th>
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
                    <td className="py-1.5">{b.sessionsTouched ?? "—"}</td>
                    <td className="py-1.5 text-fg-dim">
                      {`${((b.eventCount / totalEvents) * 100).toFixed(1)}%`}
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
