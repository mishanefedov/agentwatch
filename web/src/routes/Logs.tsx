import { useState, useMemo, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { agentColor, formatShortDate } from "../lib/format";
import { Search, History, Filter } from "lucide-react";
import clsx from "clsx";

// Relative-time presets that map to ISO `since` on the server.
const PRESETS: Array<{ id: string; label: string; hours: number | null }> = [
  { id: "1h", label: "1h", hours: 1 },
  { id: "24h", label: "24h", hours: 24 },
  { id: "7d", label: "7d", hours: 24 * 7 },
  { id: "30d", label: "30d", hours: 24 * 30 },
  { id: "all", label: "all", hours: null },
];

const AGENT_OPTIONS = ["claude-code", "codex", "gemini"] as const;

export function LogsPage() {
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<string>("7d");
  const [agents, setAgents] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const detected = useQuery({ queryKey: ["agents"], queryFn: api.agents });

  // Which agent adapters actually cover cross-search on disk.
  // (cross-search.ts today reads claude/codex/gemini JSONLs; openclaw and
  // hermes persist differently so they're surfaced separately.)
  const crossAgents = useMemo(() => new Set(AGENT_OPTIONS), []);

  const mut = useMutation({
    mutationFn: ({ q, since, agents, limit }: { q: string; since?: string; agents?: string[]; limit: number }) =>
      api.search(q, "cross", limit, { since, agents }),
  });

  const onRun = (e?: React.FormEvent) => {
    e?.preventDefault();
    const needle = q.trim();
    if (!needle) return;
    const h = PRESETS.find((p) => p.id === preset)?.hours ?? null;
    const since = h == null ? undefined : new Date(Date.now() - h * 3_600_000).toISOString();
    const agentList = agents.size > 0 ? Array.from(agents) : undefined;
    mut.mutate({ q: needle, since, agents: agentList, limit });
  };

  return (
    <div className="h-full flex flex-col">
      <form onSubmit={onRun} className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-bg-border bg-bg-surface">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-accent" />
          <h1 className="font-bold">Logs</h1>
          <span className="text-xs text-fg-dim">disk-backed history search</span>
        </div>
        <div className="relative flex-1 min-w-[240px] max-w-xl">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search every session file on disk — press enter"
            className="w-full bg-bg-elev border border-bg-border rounded-md pl-9 pr-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-fg-dim">when:</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={clsx(
                "px-2 py-1 rounded-md transition mono",
                preset === p.id
                  ? "bg-accent/20 text-accent border border-accent/40"
                  : "border border-bg-border text-fg-dim hover:bg-bg-elev",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!q.trim() || mut.isPending}
          className="px-4 py-1.5 rounded-md bg-accent/20 text-accent text-xs hover:bg-accent/30 disabled:opacity-40"
        >
          {mut.isPending ? "searching…" : "search"}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-3 px-5 py-2 border-b border-bg-border/50 text-xs bg-bg/40">
        <span className="text-fg-muted">agents:</span>
        {AGENT_OPTIONS.map((a) => {
          const active = agents.has(a);
          const installed = detected.data?.agents.find((x) => x.name === a && x.present);
          return (
            <button
              key={a}
              onClick={() => {
                const next = new Set(agents);
                if (active) next.delete(a);
                else next.add(a);
                setAgents(next);
              }}
              className={clsx(
                "px-2 py-0.5 rounded-md border transition mono",
                active
                  ? `border-accent/40 bg-accent/20 ${agentColor(a)}`
                  : `border-bg-border text-fg-dim hover:bg-bg-elev ${installed ? "" : "opacity-50"}`,
              )}
              title={installed ? `${a} (installed)` : `${a} — not detected on disk`}
            >
              {a}
            </button>
          );
        })}
        <span className="text-fg-muted ml-3">results cap:</span>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="bg-bg-elev border border-bg-border rounded-md px-2 py-0.5 mono"
        >
          {[50, 100, 200, 500].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {detected.data?.agents.some((a) => a.name === "openclaw" && a.present) && (
          <span className="ml-auto text-warn/80">
            OpenClaw + Hermes not scanned yet (SQLite storage — adapter TBD).
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {mut.isPending && <div className="p-6 text-fg-dim">searching disk…</div>}
        {mut.isError && (
          <div className="p-6 text-danger">{String((mut.error as Error).message)}</div>
        )}
        {mut.data && mut.data.hits.length === 0 && (
          <div className="p-10 text-center text-fg-dim">
            <div>No matches on disk for “{q.trim()}”.</div>
            <div className="text-xs mt-2">
              Try a wider time window, drop agent filters, or switch query to something broader.
            </div>
          </div>
        )}
        {mut.data && mut.data.hits.length > 0 && (
          <>
            <div className="px-5 py-2 text-xs text-fg-dim bg-bg-surface border-b border-bg-border">
              <Filter className="inline w-3.5 h-3.5 mr-1" />
              {mut.data.hits.length} hits
              {mut.data.totalScanned != null && mut.data.totalScanned !== mut.data.hits.length && (
                <span> · {mut.data.totalScanned} scanned before filters</span>
              )}
              <span> · window: {PRESETS.find((p) => p.id === preset)?.label}</span>
              {agents.size > 0 && <span> · agents: {Array.from(agents).join(", ")}</span>}
            </div>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-surface border-b border-bg-border z-10">
                <tr className="text-left text-xs uppercase text-fg-muted">
                  <th className="px-4 py-2 w-36">date / time</th>
                  <th className="px-2 py-2 w-28">agent</th>
                  <th className="px-2 py-2 w-44">session</th>
                  <th className="px-3 py-2">match</th>
                </tr>
              </thead>
              <tbody>
                {mut.data.hits.map((h: any, i: number) => {
                  const hit = h.hit ?? h;
                  const ts = hit.ts;
                  return (
                    <tr key={`${hit.path}:${hit.lineNumber}:${i}`} className="border-b border-bg-border/30 row-hover">
                      <td className="px-4 py-1.5 text-fg-dim mono text-xs align-top whitespace-nowrap">
                        {ts ? formatShortDate(ts) : "—"}
                      </td>
                      <td className={clsx("px-2 py-1.5 mono text-xs align-top", agentColor(hit.agent))}>
                        {hit.agent}
                      </td>
                      <td className="px-2 py-1.5 mono text-xs align-top">
                        {hit.sessionId ? (
                          <Link
                            to={`/sessions/${encodeURIComponent(hit.sessionId)}`}
                            className="hover:text-accent"
                            title={hit.sessionId}
                          >
                            {hit.sessionId.slice(0, 16)}
                          </Link>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 mono text-xs align-top whitespace-pre-wrap truncate max-w-3xl">
                        {hit.line}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        {!mut.data && !mut.isPending && (
          <div className="p-10 text-center text-fg-dim">
            <div className="mb-2">Type a query + enter.</div>
            <div className="text-xs">
              This scans the session JSONLs on disk (`~/.claude/projects/`, `~/.codex/sessions/`, `~/.gemini/tmp/`). Unlike the
              Timeline page, results go all the way back, not just since agentwatch booted.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
