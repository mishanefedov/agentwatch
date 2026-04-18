import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Search } from "lucide-react";
import clsx from "clsx";

interface Item {
  id: string;
  title: string;
  hint?: string;
  to: string;
  group: "nav" | "project" | "session";
}

const NAV_ITEMS: Item[] = [
  { id: "nav:timeline", title: "Timeline", to: "/", group: "nav" },
  { id: "nav:logs", title: "Logs (disk-backed history)", to: "/logs", group: "nav" },
  { id: "nav:projects", title: "Projects", to: "/projects", group: "nav" },
  { id: "nav:search", title: "Search", to: "/search", group: "nav" },
  { id: "nav:agents", title: "Agents", to: "/agents", group: "nav" },
  { id: "nav:permissions", title: "Permissions", to: "/permissions", group: "nav" },
  { id: "nav:cron", title: "Scheduled", to: "/cron", group: "nav" },
  { id: "nav:trends", title: "Trends", to: "/trends", group: "nav" },
  { id: "nav:budgets", title: "Settings · Budgets", to: "/settings/budgets", group: "nav" },
  { id: "nav:anomaly", title: "Settings · Anomaly", to: "/settings/anomaly", group: "nav" },
  { id: "nav:triggers", title: "Settings · Triggers", to: "/settings/triggers", group: "nav" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects, enabled: open });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
        setIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const projectItems: Item[] = useMemo(
    () =>
      (projects.data?.projects ?? []).map((p) => ({
        id: `proj:${p.name}`,
        title: p.name,
        hint: `${p.eventCount} events · ${p.sessionIds.length} sessions`,
        to: `/projects/${encodeURIComponent(p.name)}`,
        group: "project" as const,
      })),
    [projects.data],
  );

  const all = useMemo(() => [...NAV_ITEMS, ...projectItems], [projectItems]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, 20);
    return all
      .filter(
        (i) =>
          i.title.toLowerCase().includes(needle) ||
          (i.hint ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 30);
  }, [all, q]);

  useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  const choose = (it: Item) => {
    setOpen(false);
    navigate(it.to);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-bg-surface border border-bg-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-bg-border">
          <Search className="w-4 h-4 text-fg-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const it = filtered[idx];
                if (it) choose(it);
              }
            }}
            placeholder="Jump to view, project, session…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <kbd className="text-[10px] text-fg-muted mono border border-bg-border rounded px-1">esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 && <div className="p-4 text-fg-muted text-sm text-center">no results</div>}
          {filtered.map((it, i) => (
            <button
              key={it.id}
              onClick={() => choose(it)}
              className={clsx(
                "w-full flex items-center justify-between gap-3 px-4 py-2 text-left transition",
                i === idx ? "bg-accent/20 text-accent" : "text-fg hover:bg-bg-elev",
              )}
              onMouseEnter={() => setIdx(i)}
            >
              <div>
                <div className="text-sm">{it.title}</div>
                {it.hint && <div className="text-[11px] text-fg-muted">{it.hint}</div>}
              </div>
              <div className="text-[10px] text-fg-muted uppercase mono">{it.group}</div>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-bg-border flex items-center justify-between text-[11px] text-fg-muted">
          <div className="flex items-center gap-3">
            <span><kbd className="border border-bg-border rounded px-1 mono">↑↓</kbd> navigate</span>
            <span><kbd className="border border-bg-border rounded px-1 mono">↵</kbd> open</span>
          </div>
          <div>
            <kbd className="border border-bg-border rounded px-1 mono">⌘K</kbd> toggle
          </div>
        </div>
      </div>
    </div>
  );
}
