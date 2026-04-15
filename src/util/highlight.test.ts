import { describe, expect, it } from "vitest";
import { highlight, inferLang } from "./highlight.js";
import type { AgentEvent } from "../schema.js";

const evt = (o: Partial<AgentEvent>): AgentEvent => ({
  id: "x",
  ts: "2026-04-15T10:00:00Z",
  agent: "claude-code",
  type: "tool_call",
  riskScore: 0,
  ...o,
});

describe("inferLang", () => {
  it("picks bash for Bash tool or shell_exec", () => {
    expect(inferLang(evt({ tool: "Bash" }))).toBe("bash");
    expect(inferLang(evt({ type: "shell_exec" }))).toBe("bash");
    expect(inferLang(evt({ cmd: "ls" }))).toBe("bash");
  });

  it("maps file extensions to highlight.js language ids", () => {
    expect(inferLang(evt({ path: "src/app.ts" }))).toBe("typescript");
    expect(inferLang(evt({ path: "x.py" }))).toBe("python");
    expect(inferLang(evt({ path: "config.yaml" }))).toBe("yaml");
  });

  it("auto-detects JSON from content when extension is unknown", () => {
    expect(inferLang(evt({}), '{"a":1}')).toBe("json");
    expect(inferLang(evt({}), "plain text")).toBeNull();
  });
});

describe("highlight", () => {
  it("returns the original string when language is null or unsupported", () => {
    expect(highlight("hello", null)).toBe("hello");
    expect(highlight("hello", "not-a-real-lang-zzz")).toBe("hello");
  });

  it("does not throw and returns a non-empty string for a supported language", () => {
    // cli-highlight strips colors when stdout is not a TTY (vitest), so we
    // only assert the call succeeds and returns the source text intact.
    const out = highlight("const x = 1;", "typescript");
    expect(typeof out).toBe("string");
    expect(out).toContain("const");
  });
});
