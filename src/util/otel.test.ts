import { describe, expect, it } from "vitest";
import { systemOf, operationOf, otelEnabled } from "./otel.js";
import type { AgentEvent } from "../schema.js";

const evt = (o: Partial<AgentEvent>): AgentEvent => ({
  id: "x",
  ts: "2026-04-15T10:00:00Z",
  agent: "claude-code",
  type: "tool_call",
  riskScore: 0,
  ...o,
});

describe("systemOf", () => {
  it("maps known agents to gen_ai.system values", () => {
    expect(systemOf("claude-code")).toBe("anthropic");
    expect(systemOf("codex")).toBe("openai");
    expect(systemOf("aider")).toBe("openai");
    expect(systemOf("gemini")).toBe("google");
    expect(systemOf("cursor")).toBe("cursor");
  });

  it("passes unknown agents through", () => {
    expect(systemOf("newagent")).toBe("newagent");
  });
});

describe("operationOf", () => {
  it("classifies prompts/responses as chat", () => {
    expect(operationOf(evt({ type: "prompt" }))).toBe("chat");
    expect(operationOf(evt({ type: "response" }))).toBe("chat");
  });

  it("classifies tool-use-ish events as tool_use", () => {
    expect(operationOf(evt({ type: "shell_exec" }))).toBe("tool_use");
    expect(operationOf(evt({ type: "file_write" }))).toBe("tool_use");
    expect(operationOf(evt({ type: "file_read" }))).toBe("tool_use");
  });

  it("classifies compaction as context_compaction", () => {
    expect(operationOf(evt({ type: "compaction" }))).toBe("context_compaction");
  });
});

describe("otelEnabled", () => {
  it("respects AGENTWATCH_OTLP_ENDPOINT", () => {
    delete process.env.AGENTWATCH_OTLP_ENDPOINT;
    expect(otelEnabled()).toBe(false);
    process.env.AGENTWATCH_OTLP_ENDPOINT = "http://localhost:4318/v1/traces";
    expect(otelEnabled()).toBe(true);
    delete process.env.AGENTWATCH_OTLP_ENDPOINT;
  });
});
