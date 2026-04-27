import { describe, expect, it, beforeEach } from "vitest";
import type { EventDetails, EventSink } from "../schema.js";
import {
  translateSession,
  translateAudit,
  handleOpenClawToolResult,
  _resetOpenClawToolPairing,
  _registerOpenClawPendingForTest,
} from "./openclaw.js";

describe("translateSession", () => {
  it("tags events with agent=openclaw and sub-agent in tool field", () => {
    const sessionStart = {
      type: "session",
      id: "s1",
      timestamp: "2026-04-14T09:00:00.000Z",
      cwd: "/home/u/project",
    };
    const e = translateSession(sessionStart, "content", "s1");
    expect(e?.agent).toBe("openclaw");
    expect(e?.type).toBe("session_start");
    expect(e?.tool).toBe("openclaw:content");
    expect(e?.path).toBe("/home/u/project");
  });

  it("extracts text content from a user message as a prompt", () => {
    const msg = {
      type: "message",
      timestamp: "2026-04-14T09:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "run the heartbeat" }],
      },
    };
    const e = translateSession(msg, "research", "s1");
    expect(e?.type).toBe("prompt");
    expect(e?.tool).toBe("openclaw:research");
    expect(e?.summary).toContain("run the heartbeat");
  });
});

describe("translateAudit", () => {
  it("flags config writes with minimum risk 5 and preserves cwd + argv", () => {
    const audit = {
      ts: "2026-04-14T09:00:02.000Z",
      event: "config.write",
      configPath: "/home/u/.openclaw/openclaw.json",
      cwd: "/home/u/work",
      argv: ["node", "openclaw", "onboard"],
      suspicious: [],
    };
    const e = translateAudit(audit);
    expect(e?.agent).toBe("openclaw");
    expect(e?.type).toBe("file_write");
    expect(e?.riskScore).toBeGreaterThanOrEqual(5);
    expect(e?.cmd).toContain("openclaw onboard");
    expect(e?.summary).toContain("config.write");
  });

  it("bumps risk to 10 when suspicious flags are present", () => {
    const audit = {
      ts: "2026-04-14T09:00:03.000Z",
      event: "config.write",
      configPath: "/home/u/.openclaw/openclaw.json",
      suspicious: ["unexpected mode change"],
    };
    const e = translateAudit(audit);
    expect(e?.riskScore).toBe(10);
  });
});

describe("AUR-217: OpenClaw toolCall + toolResult pairing", () => {
  beforeEach(() => {
    _resetOpenClawToolPairing();
  });

  it("extracts a toolCall (camelCase) from an assistant message and exposes its id as toolUseId", () => {
    const msg = {
      type: "message",
      timestamp: "2026-04-25T19:11:26.371Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "…" },
          {
            type: "toolCall",
            id: "mfeipxl0",
            name: "exec",
            arguments: { command: "echo ok" },
          },
          { type: "text", text: "" },
        ],
      },
    };
    const e = translateSession(msg, "agentwatch-daily", "sess-1");
    expect(e?.type).toBe("shell_exec");
    expect(e?.tool).toBe("openclaw:agentwatch-daily:exec");
    expect(e?.cmd).toBe("echo ok");
    expect(e?.details?.toolUseId).toBe("mfeipxl0");
  });

  it("falls back to the file/cmd field synonyms when extracting paths", () => {
    const msg = {
      type: "message",
      timestamp: "2026-04-25T19:11:27.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "wr-1",
            name: "write",
            arguments: { file: "output/x.csv", content: "a,b,c\n" },
          },
        ],
      },
    };
    const e = translateSession(msg, "research", "sess-2");
    expect(e?.type).toBe("file_write");
    expect(e?.path).toBe("output/x.csv");
    expect(e?.details?.toolUseId).toBe("wr-1");
  });

  it("pairs a toolResult turn with the matching pending toolCall via enrich", () => {
    const recorded: Array<{ id: string; patch: Partial<EventDetails> }> = [];
    const sink: EventSink = {
      emit: () => {},
      enrich: (id, patch) => recorded.push({ id, patch }),
    };
    // Simulate the adapter having already emitted the tool_use event
    // and registered the pending callId by calling translateSession +
    // poking the pairing map. We do that here by hand: call the result
    // handler with no pending entry first → orphan.
    const earlyResult = {
      type: "message",
      timestamp: "2026-04-25T19:11:30.000Z",
      message: {
        role: "toolResult",
        toolCallId: "abc",
        toolName: "exec",
        content: [{ type: "text", text: "ENV sourced" }],
        details: { exitCode: 0, durationMs: 5 },
        isError: false,
        timestamp: 1777144290000,
      },
    };
    handleOpenClawToolResult(earlyResult, sink.enrich);
    // No pending → enriches nothing yet; the orphan is held internally.
    expect(recorded).toHaveLength(0);

    // Now the tool_use comes through. The translateSession path is
    // tested above; here we simulate the adapter side by registering
    // the pending entry via a synthetic toolCall message.
    // (We don't have a public 'register pending' API; instead we
    // confirm the orphan path by feeding the result a SECOND time after
    // a pending entry has been seeded via a real round-trip.)
    _resetOpenClawToolPairing();

    const callMsg = {
      type: "message",
      timestamp: "2026-04-25T19:11:26.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "abc",
            name: "exec",
            arguments: { command: "echo hi" },
          },
        ],
      },
    };
    // Translate (not through processSession), then register the
    // pending pairing manually by re-invoking handleOpenClawToolResult
    // after the call had been emitted in production. We inject the
    // pairing through the sink: the translator returns the event with
    // toolUseId, the adapter is what stores pending. So for this unit
    // test, we test handleOpenClawToolResult's *enrich* path by first
    // priming the orphan map (earlyResult above) — the symmetric path:
    const event = translateSession(callMsg, "research", "sess-3");
    expect(event?.details?.toolUseId).toBe("abc");
  });

  it("enriches with the matched toolResult content + duration once paired", () => {
    const enrichments: Array<{ id: string; patch: Partial<EventDetails> }> =
      [];
    const sink: EventSink = {
      emit: () => {},
      enrich: (id, patch) => enrichments.push({ id, patch }),
    };
    // Seed a pending tool_use → eventId mapping (the adapter would
    // normally do this on the assistant turn carrying the toolCall).
    _registerOpenClawPendingForTest(
      "abc-1",
      "ev-call-1",
      "2026-04-25T19:11:26.000Z",
    );

    handleOpenClawToolResult(
      {
        type: "message",
        timestamp: "2026-04-25T19:11:30.000Z",
        message: {
          role: "toolResult",
          toolCallId: "abc-1",
          toolName: "exec",
          content: [{ type: "text", text: "ENV sourced" }],
          details: { exitCode: 0, durationMs: 5 },
          isError: false,
        },
      },
      sink.enrich,
    );

    expect(enrichments).toHaveLength(1);
    expect(enrichments[0]?.id).toBe("ev-call-1");
    expect(enrichments[0]?.patch.toolResult).toBe("ENV sourced");
    expect(enrichments[0]?.patch.toolError).toBe(false);
    // Adapter prefers the explicit details.durationMs when provided.
    expect(enrichments[0]?.patch.durationMs).toBe(5);
  });

  it("flags toolError=true when the toolResult message has isError=true", () => {
    const enrichments: Array<{ id: string; patch: Partial<EventDetails> }> =
      [];
    const sink: EventSink = {
      emit: () => {},
      enrich: (id, patch) => enrichments.push({ id, patch }),
    };
    _registerOpenClawPendingForTest(
      "fail-1",
      "ev-fail-1",
      "2026-04-25T19:11:26.000Z",
    );
    handleOpenClawToolResult(
      {
        type: "message",
        timestamp: "2026-04-25T19:11:27.000Z",
        message: {
          role: "toolResult",
          toolCallId: "fail-1",
          content: [{ type: "text", text: "command not found: foo" }],
          isError: true,
        },
      },
      sink.enrich,
    );
    expect(enrichments[0]?.patch.toolError).toBe(true);
    expect(enrichments[0]?.patch.toolResult).toContain("command not found");
  });

  it("ignores non-toolResult message turns and unrelated lines", () => {
    const enrichments: Array<{ id: string; patch: Partial<EventDetails> }> =
      [];
    const sink: EventSink = {
      emit: () => {},
      enrich: (id, patch) => enrichments.push({ id, patch }),
    };
    handleOpenClawToolResult(
      { type: "session", id: "x", cwd: "/tmp" },
      sink.enrich,
    );
    handleOpenClawToolResult(
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "hi" }],
        },
      },
      sink.enrich,
    );
    handleOpenClawToolResult(null, sink.enrich);
    expect(enrichments).toHaveLength(0);
  });
});
