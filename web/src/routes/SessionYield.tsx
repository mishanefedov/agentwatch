import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatDateTime, formatUSD } from "../lib/format";
import { ArrowLeft } from "lucide-react";

export function SessionYieldPage() {
  const { id = "" } = useParams();

  const q = useQuery({
    queryKey: ["session-yield", id],
    queryFn: () => api.sessionYield(id),
    refetchInterval: 10_000,
  });

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={`/sessions/${encodeURIComponent(id)}`} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">yield</h1>
        <span className="text-sm text-fg-dim mono">{id.slice(0, 16)}</span>
      </div>

      {q.isLoading && <div className="p-6 text-fg-dim">loading…</div>}

      {!q.isLoading && q.data && q.data.ok === false && (
        <div className="p-6 text-fg-dim">
          <div className="text-sm">no yield data: <span className="mono">{q.data.reason}</span></div>
          <div className="mt-2 text-xs text-fg-muted">
            yield correlates session cost with commits landed during the session window.
            Requires the session to have a project tag and the project to be a git repo
            under <span className="mono">WORKSPACE_ROOT</span>.
          </div>
        </div>
      )}

      {!q.isLoading && q.data && q.data.ok === true && (
        <SessionYieldBody data={q.data} />
      )}
    </div>
  );
}

function SessionYieldBody({
  data,
}: {
  data: Extract<Awaited<ReturnType<typeof api.sessionYield>>, { ok: true }>;
}) {
  const y = data.yield;
  const totalLines = y.totalInsertions + y.totalDeletions;

  return (
    <>
      <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-5 gap-3 border-b border-bg-border">
        <Stat label="cost" value={formatUSD(y.costUsd)} />
        <Stat label="commits" value={String(y.commits.length)} />
        <Stat label="lines changed" value={String(totalLines)} />
        <Stat
          label="$/commit"
          value={y.costPerCommit != null ? formatUSD(y.costPerCommit) : "—"}
        />
        <Stat
          label="$/line"
          value={y.costPerLineChanged != null ? formatUSD(y.costPerLineChanged) : "—"}
        />
      </div>

      <div className="px-5 py-2 text-xs text-fg-muted">
        project <span className="mono text-fg">{data.project}</span>
        {" · "}
        repo <span className="mono">{data.repoPath}</span>
      </div>

      <div className="px-5 pb-6">
        <div className="text-xs uppercase text-fg-muted mb-2">
          commits in window
        </div>
        {y.commits.length === 0 ? (
          <div className="text-sm text-fg-dim">
            no commits landed during this session — spend without commit.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-fg-muted">
              <tr>
                <th className="py-1 w-24">hash</th>
                <th className="py-1 w-44">author / date</th>
                <th className="py-1">subject</th>
                <th className="py-1 w-14 text-right">files</th>
                <th className="py-1 w-16 text-right text-success">+</th>
                <th className="py-1 w-16 text-right text-danger">−</th>
              </tr>
            </thead>
            <tbody>
              {y.commits.map((c) => (
                <tr key={c.hash} className="mono text-xs border-b border-bg-border/30">
                  <td className="py-1.5">{c.hash.slice(0, 8)}</td>
                  <td className="py-1.5 text-fg-dim">
                    <div>{c.authorName}</div>
                    <div className="text-[10px]">{formatDateTime(c.authorDate)}</div>
                  </td>
                  <td className="py-1.5 truncate max-w-md">{c.subject}</td>
                  <td className="py-1.5 text-right">{c.filesChanged}</td>
                  <td className="py-1.5 text-right text-success">+{c.insertions}</td>
                  <td className="py-1.5 text-right text-danger">−{c.deletions}</td>
                </tr>
              ))}
              <tr className="mono text-xs font-bold border-t border-bg-border">
                <td className="py-1.5" colSpan={3}>
                  totals
                </td>
                <td className="py-1.5 text-right">{y.totalFilesChanged}</td>
                <td className="py-1.5 text-right text-success">+{y.totalInsertions}</td>
                <td className="py-1.5 text-right text-danger">−{y.totalDeletions}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </>
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
