import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { agentColor } from "../lib/format";
import { ArrowLeft, Play, AlertCircle } from "lucide-react";
import clsx from "clsx";

const REPLAY_SUPPORTED = new Set(["claude-code", "codex", "gemini", "hermes"]);

export function SessionReplayPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["session", id], queryFn: () => api.session(id) });
  const [prompt, setPrompt] = useState("");
  const [timeoutSec, setTimeoutSec] = useState(60);

  const agent = q.data?.agent ?? "unknown";
  const supported = REPLAY_SUPPORTED.has(agent);

  useEffect(() => {
    if (!q.data) return;
    const firstPromptEv = q.data.events.slice().reverse().find((e: any) => e.type === "prompt");
    const original = firstPromptEv?.details?.fullText ?? firstPromptEv?.summary ?? "";
    if (original && !prompt) setPrompt(original);
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () => api.replay(id, { prompt, timeoutSec }),
  });

  const run = mut.data;

  return (
    <div className="h-full overflow-auto">
      <div className="px-5 py-4 border-b border-bg-border flex items-baseline gap-3">
        <Link to={`/sessions/${encodeURIComponent(id)}`} className="text-fg-dim hover:text-accent">
          <ArrowLeft className="w-4 h-4 inline" />
        </Link>
        <h1 className="text-lg font-bold">replay</h1>
        <span className={clsx("text-sm", agentColor(agent as any))}>{agent}</span>
        <span className="text-sm text-fg-dim mono">{id.slice(0, 16)}</span>
      </div>

      {!supported && (
        <div className="m-5 p-4 border border-warn/40 bg-warn/10 rounded-lg flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-warn shrink-0" />
          <div>
            <div className="font-bold">Replay not supported for <span className={agentColor(agent as any)}>{agent}</span>.</div>
            <div className="text-fg-dim mt-1">
              Currently wired: claude-code, codex, gemini, hermes (single-turn exec mode). You can still edit the prompt and copy the command below.
            </div>
          </div>
        </div>
      )}

      <div className="p-5 space-y-4 max-w-4xl">
        <div>
          <label className="text-xs uppercase text-fg-muted">edited prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            spellCheck={false}
            className="mt-1 w-full bg-bg-surface border border-bg-border rounded-lg p-3 mono text-sm outline-none focus:border-accent min-h-[180px]"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-fg-dim flex items-center gap-2">
            timeout (s)
            <input
              type="number"
              min={5}
              max={300}
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Number(e.target.value) || 60)}
              className="bg-bg-surface border border-bg-border rounded-md px-2 py-1 w-20 mono"
            />
          </label>
          <button
            onClick={() => mut.mutate()}
            disabled={!supported || !prompt.trim() || mut.isPending}
            className="px-4 py-2 rounded-md bg-accent/20 text-accent hover:bg-accent/30 text-sm flex items-center gap-2 disabled:opacity-40"
          >
            <Play className="w-4 h-4" />
            {mut.isPending ? "running…" : "run replay"}
          </button>
          <div className="text-xs text-fg-muted">
            Fresh single-turn exec — doesn't resume the original session.
          </div>
        </div>

        {mut.isError && (
          <div className="border border-danger/40 bg-danger/10 rounded-lg p-3 text-sm text-danger">
            {String((mut.error as Error).message)}
          </div>
        )}

        {run && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-xs">
              <span className={clsx("mono px-2 py-1 rounded", run.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger")}>
                {run.ok ? "ok" : `failed${run.exitCode != null ? ` (code ${run.exitCode})` : ""}`}
              </span>
              <span className="text-fg-dim mono">{run.durationMs} ms</span>
              {run.error && <span className="text-danger mono">{run.error}</span>}
            </div>
            <Block label="command">
              <pre className="mono text-xs whitespace-pre-wrap">{run.command}</pre>
            </Block>
            {run.stdout && (
              <Block label="stdout">
                <pre className="mono text-xs whitespace-pre-wrap">{run.stdout}</pre>
              </Block>
            )}
            {run.stderr && (
              <Block label={<span className="text-warn">stderr</span>}>
                <pre className="mono text-xs whitespace-pre-wrap">{run.stderr}</pre>
              </Block>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Block({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-fg-muted mb-1">{label}</div>
      <div className="bg-bg-surface border border-bg-border rounded-md p-3 overflow-x-auto max-h-96 overflow-y-auto">{children}</div>
    </div>
  );
}
