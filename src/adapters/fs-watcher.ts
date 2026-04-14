import chokidar from "chokidar";
import type { AgentEvent } from "../schema.js";
import { riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";

type Emit = (e: AgentEvent) => void;

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
];

export function startFsAdapter(root: string, emit: Emit): () => void {
  const watcher = chokidar.watch(root, {
    persistent: true,
    ignoreInitial: true,
    ignored: (p) => DEFAULT_IGNORES.some((r) => r.test(p)),
    depth: 3,
  });

  watcher.on("error", (err) => {
    if (isSuppressible(err)) return;
    // eslint-disable-next-line no-console
    console.error("[agentwatch/fs]", String(err));
  });

  const emitFs = (path: string) => {
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
