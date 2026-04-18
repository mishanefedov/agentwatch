import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatUSD, formatTokens } from "../lib/format";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { ArrowLeft } from "lucide-react";

export function SessionTokensPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["session-tokens", id],
    queryFn: () => api.sessionTokens(id),
    refetchInterval: 3_000,
  });

  if (q.isLoading) return <div className="p-6 text-fg-dim">loading…</div>;
  const data = q.data?.turns ?? [];
  const total = q.data?.breakdown;

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={`/sessions/${encodeURIComponent(id)}`} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">token attribution</h1>
        <span className="text-sm text-fg-dim mono">{id.slice(0, 16)}</span>
      </div>

      {total && (
        <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-6 gap-3 border-b border-bg-border">
          <Stat label="input" value={formatTokens(total.input)} />
          <Stat label="output" value={formatTokens(total.output)} />
          <Stat label="cache read" value={formatTokens(total.cacheRead)} />
          <Stat label="cache write" value={formatTokens(total.cacheCreate)} />
          <Stat label="thinking" value={formatTokens(total.thinking)} />
          <Stat label="cost" value={formatUSD(total.cost)} />
        </div>
      )}

      <div className="p-5">
        <div className="text-xs uppercase text-fg-muted mb-2">tokens per turn</div>
        <div className="bg-bg-surface border border-bg-border rounded-lg p-3" style={{ height: 320 }}>
          <ResponsiveContainer>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
              <XAxis dataKey="turnIdx" stroke="#7d8590" tick={{ fontSize: 10 }} />
              <YAxis stroke="#7d8590" tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: "#0b0d10",
                  border: "1px solid #2b3139",
                  fontSize: 11,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="input" stackId="1" stroke="#58a6ff" fill="#58a6ff33" />
              <Area type="monotone" dataKey="output" stackId="1" stroke="#3fb950" fill="#3fb95033" />
              <Area type="monotone" dataKey="cacheRead" stackId="1" stroke="#d29922" fill="#d2992233" />
              <Area type="monotone" dataKey="cacheCreate" stackId="1" stroke="#f85149" fill="#f8514933" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="px-5 pb-6">
        <div className="text-xs uppercase text-fg-muted mb-2">per-turn rows</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-fg-muted">
            <tr>
              <th className="py-1 w-12">turn</th>
              <th className="py-1">input</th>
              <th className="py-1">output</th>
              <th className="py-1">cache r</th>
              <th className="py-1">cache w</th>
              <th className="py-1">thinking</th>
              <th className="py-1">tool i/o</th>
              <th className="py-1">cost</th>
            </tr>
          </thead>
          <tbody>
            {data.map((t: any) => (
              <tr key={t.turnIdx} className="mono text-xs border-b border-bg-border/30">
                <td className="py-1 text-fg-muted">{t.turnIdx}</td>
                <td className="py-1">{formatTokens(t.input)}</td>
                <td className="py-1">{formatTokens(t.output)}</td>
                <td className="py-1">{formatTokens(t.cacheRead)}</td>
                <td className="py-1">{formatTokens(t.cacheCreate)}</td>
                <td className="py-1">{formatTokens(t.thinking)}</td>
                <td className="py-1">{formatTokens(t.toolTokens)}</td>
                <td className="py-1">{formatUSD(t.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
