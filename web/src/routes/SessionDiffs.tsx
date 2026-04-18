import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { formatTime, agentColor } from "../lib/format";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { ArrowLeft, FileEdit, MessageSquare } from "lucide-react";
import clsx from "clsx";

export function SessionDiffsPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["session-diffs", id],
    queryFn: () => api.sessionDiffs(id),
    refetchInterval: 5_000,
  });
  const diffs: Array<any> = q.data?.diffs ?? [];

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={`/sessions/${encodeURIComponent(id)}`} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">diff attribution</h1>
        <span className="text-sm text-fg-dim mono">{id.slice(0, 16)}</span>
        <span className="text-sm text-fg-dim">{diffs.length} writes</span>
      </div>
      {q.isLoading && <div className="p-6 text-fg-dim">loading…</div>}
      {!q.isLoading && diffs.length === 0 && (
        <div className="p-10 text-center text-fg-dim">No file writes or edits in this session.</div>
      )}
      <div className="p-5 space-y-6">
        {diffs.map((d, i) => (
          <DiffCard key={i} entry={d} />
        ))}
      </div>
    </div>
  );
}

function DiffCard({ entry }: { entry: any }) {
  const ev = entry.event;
  const prompt = entry.triggeringPrompt;
  const hasEdit = entry.oldString != null && entry.newString != null;
  const hasNewContent = !hasEdit && entry.content != null;

  return (
    <div className="bg-bg-surface border border-bg-border rounded-lg">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-bg-border text-xs">
        <FileEdit className="w-3.5 h-3.5 text-accent" />
        <span className={clsx("mono", agentColor(ev.agent))}>{ev.agent}</span>
        <span className="mono text-fg-dim">{formatTime(ev.ts)}</span>
        <span className="mono text-fg-dim">{ev.type}</span>
        {ev.path && <span className="ml-auto mono text-fg-dim truncate max-w-lg">{ev.path}</span>}
      </div>
      {prompt && (
        <div className="px-4 py-2 border-b border-bg-border/50 bg-bg/30">
          <div className="flex items-center gap-1.5 text-[10px] uppercase text-fg-muted mb-1">
            <MessageSquare className="w-3 h-3" /> triggering prompt
          </div>
          <div className="text-sm mono whitespace-pre-wrap line-clamp-4">
            {prompt.details?.fullText ?? prompt.summary ?? "—"}
          </div>
          <Link to={`/events/${encodeURIComponent(prompt.id)}`} className="text-[10px] text-fg-muted hover:text-accent mono mt-1 inline-block">
            → event detail
          </Link>
        </div>
      )}
      <div className="overflow-x-auto">
        {hasEdit && (
          <div className="bg-bg">
            <ReactDiffViewer
              oldValue={entry.oldString ?? ""}
              newValue={entry.newString ?? ""}
              splitView
              compareMethod={DiffMethod.WORDS}
              useDarkTheme
              styles={{
                variables: {
                  dark: {
                    diffViewerBackground: "#0b0d10",
                    diffViewerColor: "#e6edf3",
                    addedBackground: "#0f2e1b",
                    addedColor: "#3fb950",
                    removedBackground: "#3a0f12",
                    removedColor: "#f85149",
                    gutterBackground: "#12151a",
                    gutterColor: "#7d8590",
                  },
                },
                line: { fontSize: 11, fontFamily: "JetBrains Mono, ui-monospace, monospace" },
              }}
            />
          </div>
        )}
        {hasNewContent && (
          <pre className="mono text-xs p-4 whitespace-pre-wrap max-h-96 overflow-y-auto">{entry.content}</pre>
        )}
        {!hasEdit && !hasNewContent && (
          <div className="px-4 py-3 text-xs text-fg-dim">
            No inline content (tool input didn't include old_string/new_string or content).
          </div>
        )}
      </div>
    </div>
  );
}
