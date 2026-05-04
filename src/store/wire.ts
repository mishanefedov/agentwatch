import { resolveWorkspace } from "../correlate/branch-cache.js";
import { RecentWritesIndex } from "../correlate/session-links.js";
import type { AgentEvent, EventDetails, EventSink } from "../schema.js";
import type { EventStore } from "./sqlite.js";

/** Wraps an existing EventSink so every emit/enrich is mirrored into the
 *  SQLite store. The store is the persistent source of truth; the inner
 *  sink continues to drive the in-memory TUI/SSE pipeline.
 *
 *  Failures in the store path are logged once per failure-mode and never
 *  propagated — observability must not crash the agent runtime when, e.g.,
 *  the disk is full or the WAL is locked. */
export function wrapSinkWithStore(
  inner: EventSink,
  store: EventStore,
): EventSink {
  let warnedInsert = false;
  let warnedEnrich = false;
  return {
    emit: (event) => {
      try {
        store.insert(event);
      } catch (err) {
        if (!warnedInsert) {
          warnedInsert = true;
          process.stderr.write(
            `[agentwatch] store.insert error (further occurrences suppressed): ${String(err)}\n`,
          );
        }
      }
      inner.emit(event);
    },
    enrich: (eventId: string, patch: Partial<EventDetails>) => {
      try {
        store.enrich(eventId, patch);
      } catch (err) {
        if (!warnedEnrich) {
          warnedEnrich = true;
          process.stderr.write(
            `[agentwatch] store.enrich error (further occurrences suppressed): ${String(err)}\n`,
          );
        }
      }
      inner.enrich(eventId, patch);
    },
  };
}

interface LinkerDeps {
  /** Override for tests. Defaults to the real resolveWorkspace. */
  resolve?: typeof resolveWorkspace;
}

/** AUR-276 — the session-correlation telemetry layer. Sits *after*
 *  `wrapSinkWithStore` so it sees events that have already been persisted
 *  with their session row. On every file_write / file_change event:
 *
 *    1. Resolve (workspace_root, git_branch) for the session, cached.
 *    2. Persist the resolution to the session row (first-write-wins).
 *    3. Feed (path, agent, sessionId, ts, branch, root) into the
 *       in-process RecentWritesIndex. For every peer match returned,
 *       INSERT (or bump) a session_link_candidates row.
 *
 *  No UI surface and no API field — this is data collection only.
 *  Promotion to a stitched-sessions UI is gated on AUR-277 + a manual
 *  validation gate against accumulated candidate pairs.
 *
 *  Errors are warn-once + swallow, mirroring `wrapSinkWithStore` so the
 *  observability pipeline never crashes the agent runtime. */
export function wrapSinkWithLinks(
  inner: EventSink,
  store: EventStore,
  deps: LinkerDeps = {},
): EventSink {
  const index = new RecentWritesIndex();
  const resolve = deps.resolve ?? resolveWorkspace;
  let warned = false;
  return {
    emit: (event) => {
      // CRITICAL: forward to inner FIRST. inner is wrapSinkWithStore in
      // production, which runs store.insert and fires the AFTER-INSERT
      // trigger that upserts the sessions row. processWrite then runs
      // upsertSessionWorkspace against a row that exists. If we ran
      // processWrite first, the very first file_write of every session
      // would silently fail to populate workspace_root + git_branch
      // (UPDATE on a missing row is a no-op) and short-lived sessions
      // with only one write would be permanently null — exactly the
      // telemetry data AUR-276 needs to collect.
      inner.emit(event);
      try {
        if (isLinkableWrite(event)) processWrite(event, store, index, resolve);
      } catch (err) {
        if (!warned) {
          warned = true;
          process.stderr.write(
            `[agentwatch] session-link error (further occurrences suppressed): ${String(err)}\n`,
          );
        }
      }
    },
    enrich: (eventId, patch) => inner.enrich(eventId, patch),
  };
}

function isLinkableWrite(event: AgentEvent): boolean {
  if (event.type !== "file_write" && event.type !== "file_change") return false;
  if (!event.path) return false;
  if (!event.sessionId) return false;
  // No cwd → can't resolve workspace → can't gate matches → don't bother.
  if (!event.details?.cwd) return false;
  return true;
}

function processWrite(
  event: AgentEvent,
  store: EventStore,
  index: RecentWritesIndex,
  resolve: typeof resolveWorkspace,
): void {
  const cwd = event.details?.cwd ?? null;
  const resolved = resolve(cwd);
  // Cache the resolution on the session row so downstream readers
  // (CLI, future API) can attribute candidates to a workspace + branch.
  store.upsertSessionWorkspace(event.sessionId!, {
    workspaceRoot: resolved.workspaceRoot,
    gitBranch: resolved.gitBranch,
  });
  if (resolved.workspaceRoot == null || resolved.gitBranch == null) return;
  const tsMs = Date.parse(event.ts);
  if (!Number.isFinite(tsMs)) return;
  const matches = index.recordAndQuery(
    event.path!,
    event.agent,
    event.sessionId!,
    tsMs,
    resolved.gitBranch,
    resolved.workspaceRoot,
  );
  for (const peer of matches) {
    store.recordSessionLinkCandidate({
      aSession: event.sessionId!,
      bSession: peer.sessionId,
      aAgent: event.agent,
      bAgent: peer.agent,
      samplePath: event.path!,
      ts: event.ts,
      workspaceRoot: resolved.workspaceRoot,
      gitBranch: resolved.gitBranch,
    });
  }
}
