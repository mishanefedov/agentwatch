import type { AgentEvent, AgentName, EventSink } from "../schema.js";
import { riskOf } from "../schema.js";
import { nextId } from "./ids.js";

/** Per-session running tally of unparseable JSONL lines. AUR-228. The
 *  tracker emits a single synthetic `parse_error` event the first time
 *  a session fails to parse a line, and `enrich`es it on every
 *  subsequent failure with the new count + a truncated sample of the
 *  offending line. The TUI surfaces this as a session-level warning so
 *  operators know they're seeing a partial timeline.
 *
 *  This sits behind the line-reading layer (jsonl-stream) so the count
 *  reflects only well-formed lines (newline-terminated) that JSON.parse
 *  rejected — i.e., genuine schema corruption, not the partial-flush
 *  case that AUR-227 already handles cleanly. */
export interface ParseErrorTracker {
  recordFailure(sessionKey: string, line: string): void;
}

interface Entry {
  count: number;
  eventId?: string;
}

const SAMPLE_BYTES = 200;

export function createParseErrorTracker(
  agent: AgentName,
  sink: EventSink,
  options: {
    /** Override summary prefix; defaults to `[<sessionId-prefix>]`. */
    summaryPrefix?: (sessionKey: string) => string;
  } = {},
): ParseErrorTracker {
  const entries = new Map<string, Entry>();
  return {
    recordFailure(sessionKey: string, line: string): void {
      let entry = entries.get(sessionKey);
      if (!entry) {
        entry = { count: 0 };
        entries.set(sessionKey, entry);
      }
      entry.count += 1;
      const sample = truncate(line, SAMPLE_BYTES);

      if (!entry.eventId) {
        const prefix =
          options.summaryPrefix?.(sessionKey) ?? `[${sessionKey.slice(0, 8)}] `;
        const event: AgentEvent = {
          id: nextId(),
          ts: new Date().toISOString(),
          agent,
          type: "parse_error",
          sessionId: sessionKey,
          riskScore: riskOf("parse_error"),
          summary: `${prefix}⚠ unparseable line — context loss possible`,
          details: {
            parseErrorCount: 1,
            parseErrorSample: sample,
          },
        };
        entry.eventId = event.id;
        sink.emit(event);
      } else {
        sink.enrich(entry.eventId, {
          parseErrorCount: entry.count,
          parseErrorSample: sample,
        });
      }
    },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
