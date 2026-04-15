import { describe, expect, it } from "vitest";
import { extractGeminiUsage } from "./gemini.js";

describe("extractGeminiUsage", () => {
  it("subtracts cached from total input to get fresh input", () => {
    const u = extractGeminiUsage({
      tokens: { input: 5000, output: 120, cached: 2000, thoughts: 0, tool: 0 },
    });
    expect(u).toEqual({
      input: 3000,
      cacheCreate: 0,
      cacheRead: 2000,
      output: 120,
    });
  });

  it("folds thoughts and tool tokens into output", () => {
    const u = extractGeminiUsage({
      tokens: {
        input: 1000,
        output: 10,
        cached: 0,
        thoughts: 50,
        tool: 5,
      },
    });
    expect(u?.output).toBe(65);
  });

  it("returns null when no tokens object is present", () => {
    expect(extractGeminiUsage({})).toBeNull();
  });

  it("returns null when every token field is zero", () => {
    expect(
      extractGeminiUsage({
        tokens: { input: 0, output: 0, cached: 0, thoughts: 0, tool: 0 },
      }),
    ).toBeNull();
  });
});
