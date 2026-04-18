import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import { agentColor, formatTime, typeIcon } from "../lib/format";
import { Search as SearchIcon } from "lucide-react";
import clsx from "clsx";

type Mode = "live" | "cross" | "semantic";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("live");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useMutation({
    mutationFn: ({ q, m }: { q: string; m: Mode }) => api.search(q, m, 100),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    search.mutate({ q, m: mode });
  };

  return (
    <div className="h-full flex flex-col">
      <form onSubmit={onSubmit} className="px-5 py-4 border-b border-bg-border bg-bg-surface flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search — enter to run"
            className="w-full bg-bg-elev border border-bg-border rounded-md pl-9 pr-3 py-2 outline-none focus:border-accent"
          />
        </div>
        <div className="flex rounded-md overflow-hidden border border-bg-border">
          {(["live", "cross", "semantic"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={clsx(
                "px-3 py-2 text-xs transition",
                mode === m ? "bg-accent/20 text-accent" : "bg-bg-elev text-fg-dim hover:bg-bg",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!query.trim() || search.isPending}
          className="px-4 py-2 bg-accent/20 text-accent rounded-md text-xs hover:bg-accent/30 disabled:opacity-40"
        >
          {search.isPending ? "searching…" : "search"}
        </button>
      </form>
      <ModeHint mode={mode} />
      <div className="flex-1 overflow-auto">
        {search.data?.status && (
          <div className="px-5 py-2 text-xs text-warn bg-warn/10 border-b border-warn/30">{search.data.status}</div>
        )}
        {search.data?.error && (
          <div className="px-5 py-2 text-xs text-danger bg-danger/10 border-b border-danger/30">{search.data.error}</div>
        )}
        {search.data && search.data.hits.length === 0 && !search.isPending && (
          <div className="p-10 text-center text-fg-dim">no matches.</div>
        )}
        {search.data && search.data.hits.length > 0 && <Hits hits={search.data.hits} mode={search.data.mode as Mode} />}
        {!search.data && !search.isPending && (
          <div className="p-10 text-center text-fg-dim">
            <div className="mb-1">Three modes:</div>
            <ul className="text-xs space-y-1 inline-block text-left">
              <li><b>live</b> — substring across the current in-memory buffer (fast, recent only)</li>
              <li><b>cross</b> — ripgrep across every JSONL on disk (slow first time, thorough)</li>
              <li><b>semantic</b> — hybrid BM25 + embedding search (fuzzy, needs the index built in the TUI first)</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeHint({ mode }: { mode: Mode }) {
  const hints: Record<Mode, string> = {
    live: "searching the in-memory ring buffer (500–2000 events).",
    cross: "searching every session JSONL on disk.",
    semantic: "searching the hybrid BM25 + embedding index.",
  };
  return <div className="px-5 py-2 text-xs text-fg-muted bg-bg-surface border-b border-bg-border/50">{hints[mode]}</div>;
}

function Hits({ hits }: { hits: any[]; mode: Mode }) {
  return (
    <div>
      {hits.map((h, i) => {
        if (h.kind === "live") {
          const e = h.event;
          return (
            <Link
              to={`/events/${encodeURIComponent(e.id)}`}
              key={i}
              className="block px-5 py-2 border-b border-bg-border/40 row-hover"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-fg-muted mono">{formatTime(e.ts)}</span>
                <span className={clsx("mono", agentColor(e.agent))}>{e.agent}</span>
                <span className="mono text-fg-dim">
                  {typeIcon(e.type)} {e.type}
                </span>
              </div>
              <div className="mt-0.5 mono text-sm truncate">{e.summary ?? e.cmd ?? e.path ?? e.tool ?? ""}</div>
            </Link>
          );
        }
        const hit = h.hit;
        return (
          <Link
            to={hit.sessionId ? `/sessions/${encodeURIComponent(hit.sessionId)}` : "#"}
            key={i}
            className="block px-5 py-2 border-b border-bg-border/40 row-hover"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className={clsx("mono", agentColor(hit.agent ?? "unknown"))}>{hit.agent ?? "—"}</span>
              <span className="mono text-fg-dim">{hit.sessionId?.slice(0, 20)}</span>
              {hit.score != null && <span className="text-fg-muted mono text-[10px]">score {hit.score.toFixed(3)}</span>}
            </div>
            <div className="mt-0.5 mono text-sm whitespace-pre-wrap line-clamp-3 text-fg-dim">{hit.snippet ?? ""}</div>
          </Link>
        );
      })}
    </div>
  );
}
