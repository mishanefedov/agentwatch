import type { EventSink } from "../schema.js";
import type { CursorStatus } from "./cursor.js";
import { startClaudeAdapter } from "./claude-code.js";
import { startOpenClawAdapter } from "./openclaw.js";
import { startCursorAdapter } from "./cursor.js";
import { startGeminiAdapter } from "./gemini.js";
import { startCodexAdapter } from "./codex.js";
import { startFsAdapter } from "./fs-watcher.js";

/**
 * Adapter registry. One row per data source. Keeps App.tsx free of the
 * "add adapter N+1" churn — every new adapter drops into this list and
 * App.tsx loops over it.
 *
 * Two flavors:
 *   - Adapters that take only a sink and return a stop fn
 *   - Adapters that also need the workspace root
 *   - Cursor is the outlier — it also returns a status object
 *     that the UI uses in the permissions view
 */

export interface StartedAdapter {
  name: string;
  stop: () => void;
  /** Only set for cursor today. */
  status?: CursorStatus;
}

export function startAllAdapters(
  sink: EventSink,
  workspace: string,
): StartedAdapter[] {
  const started: StartedAdapter[] = [];

  started.push({
    name: "claude-code",
    stop: wrap(() => startClaudeAdapter(sink), "claude-code"),
  });
  started.push({
    name: "openclaw",
    stop: wrap(() => startOpenClawAdapter(sink), "openclaw"),
  });

  const cursor = safeStart(() => startCursorAdapter(workspace, sink), "cursor");
  if (cursor) {
    started.push({
      name: "cursor",
      stop: cursor.stop,
      status: cursor.status,
    });
  }

  started.push({
    name: "gemini",
    stop: wrap(() => startGeminiAdapter(sink), "gemini"),
  });
  started.push({
    name: "codex",
    stop: wrap(() => startCodexAdapter(sink), "codex"),
  });
  started.push({
    name: "fs-watcher",
    stop: wrap(() => startFsAdapter(workspace, sink), "fs-watcher"),
  });

  return started;
}

export function stopAllAdapters(adapters: StartedAdapter[]): void {
  for (const a of adapters) {
    try {
      a.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[agentwatch] adapter ${a.name} stop failed:`, err);
    }
  }
}

/** Adapter start callbacks can throw on a bad environment (missing home
 *  dir, permission error). Isolate every start so one bad adapter
 *  doesn't take the process down. */
function wrap(start: () => () => void, name: string): () => void {
  try {
    return start();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[agentwatch] adapter ${name} failed to start:`, err);
    return () => {};
  }
}

function safeStart<T>(start: () => T, name: string): T | null {
  try {
    return start();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[agentwatch] adapter ${name} failed to start:`, err);
    return null;
  }
}
