import type { EventDetails, EventSink } from "../schema.js";
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
