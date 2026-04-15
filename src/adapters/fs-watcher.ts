import chokidar from "chokidar";
import type { AgentEvent, EventSink } from "../schema.js";
import { riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";
import { wasRecentlyWrittenByAgent } from "../util/recent-writes.js";

type Emit = EventSink | ((e: AgentEvent) => void);

const DEFAULT_IGNORES = [
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])\.git([/\\]|$)/,
  /(^|[/\\])dist([/\\]|$)/,
  /(^|[/\\])build([/\\]|$)/,
  /(^|[/\\])\.next([/\\]|$)/,
  /(^|[/\\])\.cache([/\\]|$)/,
  /(^|[/\\])\.turbo([/\\]|$)/,
  /(^|[/\\])target([/\\]|$)/,
  /(^|[/\\])coverage([/\\]|$)/,
  /(^|[/\\])\.venv([/\\]|$)/,
  /(^|[/\\])venv([/\\]|$)/,
  /(^|[/\\])__pycache__([/\\]|$)/,
  /(^|[/\\])\.pytest_cache([/\\]|$)/,
  /(^|[/\\])\.idea([/\\]|$)/,
  /(^|[/\\])\.vscode([/\\]|$)/,
  /(^|[/\\])\.DS_Store$/,
  /\.log$/,
  /\.lock$/,
  /package-lock\.json$/,
  /pnpm-lock\.yaml$/,
  /yarn\.lock$/,
  /bun\.lockb$/,
  // Terminal recording artifacts — asciinema's .cast, ttyrec, etc.
  /\.cast$/,
  /\.ttyrec$/,
  // Our own demo assets — don't surface recording a demo as agent activity
  /(^|[/\\])docs[/\\]demo\./,
];

export function startFsAdapter(root: string, sink: Emit): () => void {
  const emit = typeof sink === "function" ? sink : sink.emit;
  // Unless explicitly opted in, skip watching the workspace tree at all.
  // The fs-watcher was a nice-to-have that doesn't pull its weight on
  // large monorepos — a 10k-dir tree can take seconds to establish
  // watches and exhausts inotify limits on Linux. Opt in via
  // AGENTWATCH_WATCH_WORKSPACE=1 when you actually want generic file
  // change events alongside agent activity.
  if (process.env.AGENTWATCH_WATCH_WORKSPACE !== "1") {
    return () => {};
  }
  const watcher = chokidar.watch(root, {
    persistent: true,
    ignoreInitial: true,
    ignored: (p) => DEFAULT_IGNORES.some((r) => r.test(p)),
    depth: 2,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  watcher.on("error", (err) => {
    if (isSuppressible(err)) return;
    // eslint-disable-next-line no-console
    console.error("[agentwatch/fs]", String(err));
  });

  const emitFs = (path: string) => {
    // Skip paths already attributed to an agent write within the dedupe
    // window — avoids double-counting Claude's own Edit / Write / MultiEdit.
    if (wasRecentlyWrittenByAgent(path)) return;
    const event: AgentEvent = {
      id: nextId(),
      ts: new Date().toISOString(),
      agent: "unknown",
      type: "file_change",
      path,
      summary: path,
      riskScore: riskOf("file_change", path),
    };
    emit(event);
  };

  watcher.on("add", emitFs);
  watcher.on("change", emitFs);

  return () => {
    void watcher.close();
  };
}

function isSuppressible(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === "EMFILE" || code === "ENOSPC" || code === "EACCES";
}
