import { useEventStore } from "../lib/store";
import { Link } from "react-router-dom";
import { useState, useMemo, useRef, useEffect } from "react";
import { agentColor, formatTime, riskClass, typeIcon } from "../lib/format";
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

export function TimelinePage() {
  const events = useEventStore((s) => s.events);
  const initialized = useEventStore((s) => s.initialized);
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState<AgentName | "all">("all");
  const [type, setType] = useState<EventType | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // Global `/` hotkey focuses the filter input (ignored inside other inputs).
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

  // Build filter options from the actual buffer so users can't pick a
  // filter that returns zero (and so the counts tell them how many
  // events each option matches).
  const agentCounts = useMemo(() => {
    const m = new Map<AgentName, number>();
    for (const e of events) m.set(e.agent, (m.get(e.agent) ?? 0) + 1);
    return m;
  }, [events]);

  const typeCounts = useMemo(() => {
    const m = new Map<EventType, number>();
    for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [events]);

  const agentOptions = useMemo(
    () =>
      [["all", events.length] as [AgentName | "all", number]].concat(
        Array.from(agentCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [k, v] as [AgentName | "all", number]),
      ),
    [events.length, agentCounts],
  );

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
    return events.filter((e) => {
      if (agent !== "all" && e.agent !== agent) return false;
      if (type !== "all" && e.type !== type) return false;
      if (!needle) return true;
      return (
        (e.summary ?? "").toLowerCase().includes(needle) ||
        (e.path ?? "").toLowerCase().includes(needle) ||
        (e.cmd ?? "").toLowerCase().includes(needle) ||
        (e.tool ?? "").toLowerCase().includes(needle) ||
        (e.details?.fullText ?? "").toLowerCase().includes(needle)
      );
    });
  }, [events, q, agent, type]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-bg-border bg-bg-surface">
        <div className="relative flex-1 max-w-lg">
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
        <div className="ml-auto text-xs text-fg-dim">
          <Filter className="inline w-3.5 h-3.5 mr-1" />
          {filtered.length} / {events.length} events
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {!initialized && <div className="p-6 text-fg-dim">loading…</div>}
        {initialized && events.length === 0 && (
          <div className="p-10 text-center text-fg-dim">
            <div className="mb-2">No events yet.</div>
            <div className="text-xs">
              Launch a Claude Code / Codex / Cursor / Gemini / Hermes / OpenClaw session and events will stream in real-time.
            </div>
          </div>
        )}
        {initialized && events.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-surface border-b border-bg-border z-10">
              <tr className="text-left text-xs uppercase text-fg-muted">
                <th className="px-4 py-2 w-20">time</th>
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
      <td className="px-4 py-1.5 text-fg-dim mono text-xs align-top">{formatTime(event.ts)}</td>
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
