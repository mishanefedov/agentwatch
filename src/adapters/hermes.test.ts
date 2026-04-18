import { describe, expect, it } from "vitest";
import {
  translateHermesSessionStart,
  translateHermesSessionEnd,
  translateHermesMessage,
  type HermesMessage,
  type HermesSession,
} from "./hermes.js";

const BASE_SESSION: HermesSession = {
  id: "sess-abcdef12",
  source: "cli",
  user_id: "misha",
  model: "hermes-3-70b",
  parent_session_id: null,
  started_at: 1715000000,
  ended_at: null,
  end_reason: null,
  input_tokens: null,
  output_tokens: null,
  cache_read_tokens: null,
  cache_write_tokens: null,
  actual_cost_usd: null,
  estimated_cost_usd: null,
};

describe("translateHermesSessionStart", () => {
  it("emits session_start tagged agent=hermes with model + parent linkage", () => {
    const e = translateHermesSessionStart(
      { ...BASE_SESSION, parent_session_id: "parent-xyz" },
      "/home/u/.hermes/state.db",
    );
    expect(e.agent).toBe("hermes");
    expect(e.type).toBe("session_start");
    expect(e.sessionId).toBe("sess-abcdef12");
    expect(e.details?.model).toBe("hermes-3-70b");
    expect(e.details?.parentSpawnId).toBe("parent-xyz");
    expect(e.summary).toContain("sess-abc");
  });
});

describe("translateHermesSessionEnd", () => {
  it("carries usage totals and cost into details", () => {
    const e = translateHermesSessionEnd(
      {
        ...BASE_SESSION,
        ended_at: 1715000500,
        end_reason: "normal",
        input_tokens: 1234,
        output_tokens: 567,
        cache_read_tokens: 100,
        cache_write_tokens: 50,
        actual_cost_usd: 0.042,
      },
      "/home/u/.hermes/state.db",
    );
    expect(e.type).toBe("session_end");
    expect(e.details?.usage).toEqual({
      input: 1234,
      cacheCreate: 50,
      cacheRead: 100,
      output: 567,
    });
    expect(e.details?.cost).toBe(0.042);
    expect(e.summary).toContain("normal");
  });
});

const BASE_MSG: HermesMessage = {
  id: 1,
  session_id: "sess-abcdef12",
  role: "user",
  content: null,
  tool_call_id: null,
  tool_calls: null,
  tool_name: null,
  timestamp: 1715000010,
  token_count: null,
  finish_reason: null,
  reasoning: null,
};

describe("translateHermesMessage", () => {
  it("maps role=user to prompt with content in fullText", () => {
    const e = translateHermesMessage(
      { ...BASE_MSG, role: "user", content: "run the eval suite" },
      "/db",
    );
    expect(e?.type).toBe("prompt");
    expect(e?.agent).toBe("hermes");
    expect(e?.details?.fullText).toBe("run the eval suite");
    expect(e?.summary).toContain("run the eval");
  });

  it("maps role=assistant with no tool_calls to response (reasoning preserved)", () => {
    const e = translateHermesMessage(
      {
        ...BASE_MSG,
        role: "assistant",
        content: "here is the plan",
        reasoning: "step-by-step analysis",
      },
      "/db",
    );
    expect(e?.type).toBe("response");
    expect(e?.details?.fullText).toBe("here is the plan");
    expect(e?.details?.thinking).toBe("step-by-step analysis");
  });

  it("maps role=assistant with tool_calls JSON to tool_call with parsed name + input", () => {
    const e = translateHermesMessage(
      {
        ...BASE_MSG,
        role: "assistant",
        content: null,
        tool_calls: JSON.stringify([
          {
            id: "call_1",
            function: { name: "search_web", arguments: JSON.stringify({ q: "llama" }) },
          },
        ]),
      },
      "/db",
    );
    expect(e?.type).toBe("tool_call");
    expect(e?.tool).toBe("search_web");
    expect(e?.details?.toolInput).toEqual({ q: "llama" });
    expect(e?.summary).toContain("search_web");
  });

  it("wraps non-JSON tool arguments as { raw } so data isn't lost", () => {
    const e = translateHermesMessage(
      {
        ...BASE_MSG,
        role: "assistant",
        tool_calls: JSON.stringify([
          { function: { name: "echo", arguments: "not-json" } },
        ]),
      },
      "/db",
    );
    expect(e?.type).toBe("tool_call");
    expect(e?.details?.toolInput).toEqual({ raw: "not-json" });
  });

  it("forwards tool_call_id as toolUseId for later pairing with tool_result", () => {
    const e = translateHermesMessage(
      {
        ...BASE_MSG,
        role: "assistant",
        tool_calls: JSON.stringify([{ function: { name: "t" } }]),
        tool_call_id: "tc-123",
      },
      "/db",
    );
    expect(e?.details?.toolUseId).toBe("tc-123");
  });

  it("drops role=tool and role=system messages", () => {
    expect(translateHermesMessage({ ...BASE_MSG, role: "tool" }, "/db")).toBeNull();
    expect(translateHermesMessage({ ...BASE_MSG, role: "function" }, "/db")).toBeNull();
    expect(translateHermesMessage({ ...BASE_MSG, role: "system" }, "/db")).toBeNull();
  });

  it("truncates long content into a single-line summary under 140 chars", () => {
    const long = "x".repeat(500);
    const e = translateHermesMessage(
      { ...BASE_MSG, role: "user", content: long },
      "/db",
    );
    expect(e?.summary?.length).toBeLessThanOrEqual(140);
    expect(e?.summary?.endsWith("...")).toBe(true);
  });
});
