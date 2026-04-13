import chokidar from "chokidar";
import type { AgentEvent } from "../schema.js";
import { riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";

type Emit = (e: AgentEvent) => void;

const DEFAULT_IGNORES = [
  /(^|[/\\])node_modules[/\\]/,
  /(^|[/\\])\.git[/\\]/,
  /(^|[/\\])dist[/\\]/,
  /(^|[/\\])build[/\\]/,
  /(^|[/\\])\.next[/\\]/,
  /(^|[/\\])\.cache[/\\]/,
  /(^|[/\\])target[/\\]/,
  /\.log$/,
];

export function startFsAdapter(root: string, emit: Emit): () => void {
  const watcher = chokidar.watch(root, {
    persistent: true,
    ignoreInitial: true,
    ignored: (p) => DEFAULT_IGNORES.some((r) => r.test(p)),
    depth: 8,
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

  return () => watcher.close();
}
