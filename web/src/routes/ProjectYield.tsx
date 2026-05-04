import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatUSD } from "../lib/format";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ArrowLeft } from "lucide-react";

type SortKey = "cost" | "lines" | "files";

export function ProjectYieldPage() {
  const { name = "" } = useParams();
  const decoded = decodeURIComponent(name);

  const q = useQuery({
    queryKey: ["project-yield", name],
    queryFn: () => api.projectYield(name),
    refetchInterval: 10_000,
  });

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link
          to={`/projects/${encodeURIComponent(decoded)}`}
          className="text-fg-dim hover:text-accent"
        >
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">yield</h1>
        <span className="text-sm text-fg-dim mono">{decoded}</span>
      </div>

      {q.isLoading && <div className="p-6 text-fg-dim">loading…</div>}

      {!q.isLoading && q.data && q.data.ok === false && (
        <div className="p-6 text-fg-dim">
          <div className="text-sm">
            no yield data: <span className="mono">{q.data.reason}</span>
          </div>
          <div className="mt-2 text-xs text-fg-muted">
            yield correlates project sessions with the commits landed during their
            windows. Requires the project to be a git repo under{" "}
            <span className="mono">WORKSPACE_ROOT</span>.
          </div>
        </div>
      )}

      {!q.isLoading && q.data && q.data.ok === true && (
        <ProjectYieldBody data={q.data} />
      )}
    </div>
  );
}

function ProjectYieldBody({
  data,
}: {
  data: Extract<Awaited<ReturnType<typeof api.projectYield>>, { ok: true }>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const y = data.yield;

  const totals = useMemo(() => {
    let cost = 0;
    let commits = 0;
    for (const w of y.weekly) {
      cost += w.costUsd;
      commits += w.commits;
    }
    const overallPerCommit = commits > 0 ? cost / commits : null;
    return { cost, commits, overallPerCommit };
  }, [y.weekly]);

  const sortedSpend = useMemo(() => {
    const copy = [...y.spendWithoutCommit];
    if (sortKey === "cost") {
      copy.sort((a, b) => b.costUsd - a.costUsd);
    } else if (sortKey === "lines") {
      copy.sort(
        (a, b) =>
          b.totalInsertions + b.totalDeletions - (a.totalInsertions + a.totalDeletions),
      );
    } else {
      copy.sort((a, b) => b.totalFilesChanged - a.totalFilesChanged);
    }
    return copy;
  }, [y.spendWithoutCommit, sortKey]);

  const empty = y.weekly.length === 0 && y.spendWithoutCommit.length === 0;

  return (
    <>
      <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-3 border-b border-bg-border">
        <Stat label="weeks tracked" value={String(y.weekly.length)} />
        <Stat label="total cost" value={formatUSD(totals.cost)} />
        <Stat label="total commits" value={String(totals.commits)} />
        <Stat
          label="overall $/commit"
          value={totals.overallPerCommit != null ? formatUSD(totals.overallPerCommit) : "—"}
        />
      </div>

      <div className="px-5 py-2 text-xs text-fg-muted">
        repo <span className="mono">{data.repoPath}</span>
      </div>

      {empty ? (
        <div className="p-6 text-fg-dim text-sm">
          no sessions or commits in window for this project yet.
        </div>
      ) : (
        <>
          <div className="p-5">
            <div className="text-xs uppercase text-fg-muted mb-2">
              weekly spend vs commits ($/commit overlay)
            </div>
            <div
              className="bg-bg-surface border border-bg-border rounded-lg p-3"
              style={{ height: 320 }}
            >
              <ResponsiveContainer>
                <ComposedChart data={y.weekly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2b3139" />
                  <XAxis
                    dataKey="weekStart"
                    stroke="#7d8590"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(t: string) => t.slice(0, 10)}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="#7d8590"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#7d8590"
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0b0d10",
                      border: "1px solid #2b3139",
                      fontSize: 11,
                    }}
                    formatter={(v, name) => {
                      const val = typeof v === "number" ? v : Number(v ?? 0);
                      if (name === "costUsd") return [formatUSD(val), "cost"];
                      if (name === "costPerCommit")
                        return [val ? formatUSD(val) : "—", "$/commit"];
                      return [String(val), String(name ?? "")];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="costUsd" name="cost" fill="#58a6ff66" />
                  <Bar yAxisId="right" dataKey="commits" name="commits" fill="#3fb95066" />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="costPerCommit"
                    name="$/commit"
                    stroke="#d29922"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="px-5 pb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="text-xs uppercase text-fg-muted">
                spend without commit
              </div>
              <span className="text-xs text-fg-dim">
                {sortedSpend.length} session{sortedSpend.length === 1 ? "" : "s"}
              </span>
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span className="text-fg-muted">sort:</span>
                <SortBtn k="cost" cur={sortKey} onClick={setSortKey}>
                  cost
                </SortBtn>
                <SortBtn k="lines" cur={sortKey} onClick={setSortKey}>
                  lines
                </SortBtn>
                <SortBtn k="files" cur={sortKey} onClick={setSortKey}>
                  files
                </SortBtn>
              </div>
            </div>
            {sortedSpend.length === 0 ? (
              <div className="text-sm text-fg-dim">
                every session in this project landed at least one commit. ✨
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-fg-muted">
                  <tr>
                    <th className="py-1">session</th>
                    <th className="py-1 w-24 text-right">cost</th>
                    <th className="py-1 w-20 text-right">files</th>
                    <th className="py-1 w-20 text-right text-success">+</th>
                    <th className="py-1 w-20 text-right text-danger">−</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSpend.map((s) => (
                    <tr
                      key={s.sessionId}
                      className="mono text-xs border-b border-bg-border/30"
                    >
                      <td className="py-1.5">
                        <Link
                          to={`/sessions/${encodeURIComponent(s.sessionId)}`}
                          className="hover:text-accent"
                        >
                          {s.sessionId.slice(0, 24)}
                        </Link>
                      </td>
                      <td className="py-1.5 text-right">{formatUSD(s.costUsd)}</td>
                      <td className="py-1.5 text-right">{s.totalFilesChanged}</td>
                      <td className="py-1.5 text-right text-success">
                        +{s.totalInsertions}
                      </td>
                      <td className="py-1.5 text-right text-danger">
                        −{s.totalDeletions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

function SortBtn({
  k,
  cur,
  onClick,
  children,
}: {
  k: SortKey;
  cur: SortKey;
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = k === cur;
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      className={
        active
          ? "px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/40"
          : "px-2 py-0.5 rounded border border-bg-border text-fg-dim hover:text-accent"
      }
    >
      {children}
    </button>
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
