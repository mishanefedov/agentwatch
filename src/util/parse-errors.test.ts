import { describe, expect, it } from "vitest";
import type { AgentEvent, EventDetails, EventSink } from "../schema.js";
import { createParseErrorTracker } from "./parse-errors.js";

function makeRecorder(): {
  sink: EventSink;
  emitted: AgentEvent[];
  enrichments: Array<{ id: string; patch: Partial<EventDetails> }>;
} {
  const emitted: AgentEvent[] = [];
  const enrichments: Array<{ id: string; patch: Partial<EventDetails> }> = [];
  return {
    sink: {
      emit: (e) => emitted.push(e),
      enrich: (id, patch) => enrichments.push({ id, patch }),
    },
    emitted,
    enrichments,
  };
}

describe("createParseErrorTracker", () => {
  it("emits one synthetic parse_error event on the first failure per session", () => {
    const r = makeRecorder();
    const tracker = createParseErrorTracker("claude-code", r.sink);
    tracker.recordFailure("sess-A", "{garbled");
    expect(r.emitted).toHaveLength(1);
    expect(r.emitted[0]?.type).toBe("parse_error");
    expect(r.emitted[0]?.sessionId).toBe("sess-A");
    expect(r.emitted[0]?.details?.parseErrorCount).toBe(1);
    expect(r.emitted[0]?.details?.parseErrorSample).toBe("{garbled");
  });

  it("enriches the existing event on subsequent failures, not emit new ones", () => {
    const r = makeRecorder();
    const tracker = createParseErrorTracker("codex", r.sink);
    tracker.recordFailure("sess-B", "first bad");
    tracker.recordFailure("sess-B", "second bad");
    tracker.recordFailure("sess-B", "third bad");
    expect(r.emitted).toHaveLength(1);
    expect(r.enrichments).toHaveLength(2);
    expect(r.enrichments[1]?.patch.parseErrorCount).toBe(3);
    expect(r.enrichments[1]?.patch.parseErrorSample).toBe("third bad");
  });

  it("tracks separate counts per session", () => {
    const r = makeRecorder();
    const tracker = createParseErrorTracker("openclaw", r.sink);
    tracker.recordFailure("sess-X", "x1");
    tracker.recordFailure("sess-Y", "y1");
    tracker.recordFailure("sess-X", "x2");
    expect(r.emitted).toHaveLength(2);
    const sessions = r.emitted.map((e) => e.sessionId).sort();
    expect(sessions).toEqual(["sess-X", "sess-Y"]);
    // Y still at 1, X now at 2 (one enrichment).
    expect(r.enrichments).toHaveLength(1);
    expect(r.enrichments[0]?.patch.parseErrorCount).toBe(2);
  });

  it("truncates very long samples to keep the timeline readable", () => {
    const r = makeRecorder();
    const tracker = createParseErrorTracker("claude-code", r.sink);
    const long = "x".repeat(1000);
    tracker.recordFailure("sess-Z", long);
    const sample = r.emitted[0]?.details?.parseErrorSample ?? "";
    expect(sample.length).toBeLessThanOrEqual(200);
    expect(sample.endsWith("…")).toBe(true);
  });
});
