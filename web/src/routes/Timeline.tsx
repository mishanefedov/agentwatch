import { useEventStore } from "../lib/store";
import { Link } from "react-router-dom";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { agentColor, formatShortDate, riskClass, typeIcon } from "../lib/format";
import type { AgentEvent, AgentName, EventType } from "../lib/types";
import { Search, Filter } from "lucide-react";
import clsx from "clsx";

const EVENT_TYPES: Array<EventType> = [
  "prompt",
  "response",
  "tool_call",
  "shell_exec",
  "file_write",
  "file_read",
  "file_change",
  "session_start",
  "session_end",
  "compaction",
];

// Preset time windows (ms). `null` = no upper bound on age.
const DATE_PRESETS: Array<{ id: string; label: string; ms: number | null }> = [
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "24h", label: "24h", ms: 24 * 60 * 60_000 },
  { id: "7d", label: "7d", ms: 7 * 24 * 60 * 60_000 },
  { id: "all", label: "all", ms: null },
];

export function TimelinePage() {
  const events = useEventStore((s) => s.events);
  const initialized = useEventStore((s) => s.initialized);
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState<AgentName | "all">("all");
  const [type, setType] = useState<EventType | "all">("all");
  // Default to 24h so the first render isn't the full buffer — makes
  // the initial paint and any subsequent filter change snappy.
  const [preset, setPreset] = useState<string>("24h");
  const inputRef = useRef<HTMLInputElement>(null);

  // Detected agents from the server — even those with 0 buffer events.
  // Buffer-only dropdown was a UX trap: agents you used before launching
  // agentwatch show 0 live events and disappeared from the filter.
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: api.agents,
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Client-side counts from the current live buffer.
  const bufferAgentCounts = useMemo(() => {
    const m = new Map<AgentName, number>();
    for (const e of events) m.set(e.agent, (m.get(e.agent) ?? 0) + 1);
    return m;
  }, [events]);

  const typeCounts = useMemo(() => {
    const m = new Map<EventType, number>();
    for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [events]);

  // Dropdown: use detected agents (always accurate about what's installed)
  // + live buffer count so the user sees "gemini (0)" meaning "installed
  // but no live events captured yet — generate one or visit /logs".
  const agentOptions = useMemo(() => {
    const opts: Array<[AgentName | "all", number]> = [
      ["all", events.length],
    ];
    const detected = agentsQuery.data?.agents ?? [];
    for (const d of detected) {
      if (!d.present || !d.instrumented) continue;
      opts.push([d.name, bufferAgentCounts.get(d.name) ?? 0]);
    }
    // Also list any agent seen in the buffer that wasn't in detection
    // (e.g. detection edge case) so nothing is hidden.
    for (const [name, n] of bufferAgentCounts) {
      if (!opts.find((o) => o[0] === name)) opts.push([name, n]);
    }
    return opts;
  }, [agentsQuery.data, bufferAgentCounts, events.length]);

  const typeOptions = useMemo(
    () =>
      [["all", events.length] as [EventType | "all", number]].concat(
        EVENT_TYPES.filter((t) => typeCounts.has(t)).map(
          (t) => [t, typeCounts.get(t)!] as [EventType | "all", number],
        ),
      ),
    [events.length, typeCounts],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const window = DATE_PRESETS.find((p) => p.id === preset)?.ms ?? null;
    const cutoff = window != null ? Date.now() - window : 0;
    return events.filter((e) => {
      if (agent !== "all" && e.agent !== agent) return false;
      if (type !== "all" && e.type !== type) return false;
      if (window != null) {
        const t = new Date(e.ts).getTime();
        if (t < cutoff) return false;
      }
      if (!needle) return true;
      return (
        (e.summary ?? "").toLowerCase().includes(needle) ||
        (e.path ?? "").toLowerCase().includes(needle) ||
        (e.cmd ?? "").toLowerCase().includes(needle) ||
        (e.tool ?? "").toLowerCase().includes(needle) ||
        (e.details?.fullText ?? "").toLowerCase().includes(needle)
      );
    });
  }, [events, q, agent, type, preset]);

  const showEmptyExplainer =
    initialized && events.length > 0 && filtered.length === 0 && agent !== "all";

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-bg-border bg-bg-surface">
        <div className="relative flex-1 min-w-[240px] max-w-lg">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter the live buffer…  (press / to focus)"
            className="w-full bg-bg-elev border border-bg-border rounded-md pl-9 pr-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <FilterChip label="agent" value={agent} options={agentOptions} onChange={(v) => setAgent(v as typeof agent)} />
        <FilterChip label="type" value={type} options={typeOptions} onChange={(v) => setType(v as typeof type)} />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-fg-dim">window:</span>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
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
        <div className="ml-auto text-xs text-fg-dim">
          <Filter className="inline w-3.5 h-3.5 mr-1" />
          {filtered.length} / {events.length} events
        </div>
      </div>

      {showEmptyExplainer && (
        <div className="px-5 py-2 text-xs text-warn bg-warn/10 border-b border-warn/30">
          No <span className="mono">{agent}</span> events in the live buffer. agentwatch only captures events fired <i>after</i> it started.
          To see historical <span className="mono">{agent}</span> activity, open the <Link to="/logs" className="text-accent underline">Logs</Link> view (reads disk JSONLs).
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {!initialized && <div className="p-6 text-fg-dim">loading…</div>}
        {initialized && events.length === 0 && (
          <div className="p-10 text-center text-fg-dim">
            <div className="mb-2">No events yet.</div>
            <div className="text-xs">
              Launch a Claude Code / Codex / Cursor / Gemini / Hermes / OpenClaw session and events will stream in real-time.{" "}
              <Link to="/logs" className="text-accent underline">Or open /logs to search historical JSONLs.</Link>
            </div>
          </div>
        )}
        {initialized && events.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-surface border-b border-bg-border z-10">
              <tr className="text-left text-xs uppercase text-fg-muted">
                <th className="px-4 py-2 w-36">date / time</th>
                <th className="px-2 py-2 w-28">agent</th>
                <th className="px-2 py-2 w-32">type</th>
                <th className="px-2 py-2 w-10">risk</th>
                <th className="px-3 py-2">event</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: AgentEvent }) {
  const summary = event.summary ?? event.cmd ?? event.path ?? event.tool ?? "—";
  return (
    <tr className="border-b border-bg-border/40 row-hover">
      <td className="px-4 py-1.5 text-fg-dim mono text-xs align-top whitespace-nowrap">
        {formatShortDate(event.ts)}
      </td>
      <td className={clsx("px-2 py-1.5 mono text-xs align-top", agentColor(event.agent))}>{event.agent}</td>
      <td className="px-2 py-1.5 mono text-xs align-top">
        <span className="text-fg-muted mr-1">{typeIcon(event.type)}</span>
        {event.type}
      </td>
      <td className="px-2 py-1.5 align-top">
        <span className={clsx("inline-block text-[10px] mono px-1.5 py-0.5 rounded", riskClass(event.riskScore))}>
          {event.riskScore}
        </span>
      </td>
      <td className="px-3 py-1.5 align-top">
        <Link to={`/events/${encodeURIComponent(event.id)}`} className="hover:text-accent">
          <span className="mono text-xs truncate inline-block max-w-3xl">{summary}</span>
        </Link>
        {event.sessionId && (
          <Link
            to={`/sessions/${encodeURIComponent(event.sessionId)}`}
            className="ml-3 text-[10px] text-fg-muted hover:text-accent mono"
            title={event.sessionId}
          >
            session:{event.sessionId.slice(0, 10)}
          </Link>
        )}
      </td>
    </tr>
  );
}

function FilterChip<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<[T, number]>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-fg-dim">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-bg-elev border border-bg-border rounded-md px-2 py-1 outline-none focus:border-accent"
      >
        {options.map(([v, count]) => (
          <option key={v} value={v}>
            {v} ({count})
          </option>
        ))}
      </select>
    </label>
  );
}
