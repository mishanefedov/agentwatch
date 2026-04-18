import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { formatUSD } from "../lib/format";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { BarChart3 } from "lucide-react";

const AGENT_COLORS: Record<string, string> = {
  "claude-code": "#f0883e",
  codex: "#3fb950",
  cursor: "#da70d6",
  gemini: "#58a6ff",
  openclaw: "#2dd4bf",
  hermes: "#facc15",
  aider: "#ec4899",
  cline: "#bef264",
  windsurf: "#5eead4",
  goose: "#fbbf24",
  continue: "#a78bfa",
  unknown: "#7d8590",
};

export function TrendsPage() {
  const [days, setDays] = useState(30);
  const cost = useQuery({ queryKey: ["trends-cost", days], queryFn: () => api.trendsCost(days), refetchInterval: 30_000 });
  const cache = useQuery({ queryKey: ["trends-cache-hit", days], queryFn: () => api.trendsCacheHit(days), refetchInterval: 30_000 });
  const byAgent = useQuery({ queryKey: ["trends-by-agent", days], queryFn: () => api.trendsByAgent(days), refetchInterval: 30_000 });

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <BarChart3 className="w-5 h-5 text-accent" />
        <h1 className="text-lg font-bold">trends</h1>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-fg-dim">window:</span>
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 rounded-md border ${d === days ? "bg-accent/20 text-accent border-accent/40" : "border-bg-border text-fg-dim hover:bg-bg-elev"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div className="p-5 space-y-6 max-w-6xl">
        <Card title="Cost per day (USD)" subtitle="Assistant-turn costs summed across all sessions.">
          <div style={{ height: 260 }}>
            {cost.data && (
              <ResponsiveContainer>
                <BarChart data={cost.data.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
                  <XAxis dataKey="day" stroke="#7d8590" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#7d8590" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                  <Tooltip formatter={(v: any) => formatUSD(Number(v))} contentStyle={{ background: "#0b0d10", border: "1px solid #2b3139", fontSize: 11 }} />
                  <Bar dataKey="cost" fill="#58a6ff" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card
          title="Cache-hit ratio"
          subtitle="Fraction of input tokens served from prompt cache. A drop here usually means the provider's cache has invalidated (AUR-215)."
        >
          <div style={{ height: 260 }}>
            {cache.data && (
              <ResponsiveContainer>
                <LineChart data={cache.data.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
                  <XAxis dataKey="day" stroke="#7d8590" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 1]} stroke="#7d8590" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                  <Tooltip
                    formatter={(v: any) => `${(Number(v) * 100).toFixed(1)}%`}
                    contentStyle={{ background: "#0b0d10", border: "1px solid #2b3139", fontSize: 11 }}
                  />
                  <Line type="monotone" dataKey="hitRatio" stroke="#3fb950" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card title="Events per agent per day" subtitle="Stacked event counts — shows cross-agent workload distribution (AUR-115).">
          <div style={{ height: 280 }}>
            {byAgent.data && (
              <ResponsiveContainer>
                <BarChart data={byAgent.data.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
                  <XAxis dataKey="day" stroke="#7d8590" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#7d8590" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0b0d10", border: "1px solid #2b3139", fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {byAgent.data.agents.map((a) => (
                    <Bar key={a} dataKey={a} stackId="agents" fill={AGENT_COLORS[a] ?? "#7d8590"} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-surface border border-bg-border rounded-lg p-4">
      <div className="mb-1 font-bold">{title}</div>
      {subtitle && <div className="text-xs text-fg-dim mb-3">{subtitle}</div>}
      {children}
    </div>
  );
}
