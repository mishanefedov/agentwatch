import { describe, expect, it } from "vitest";
import {
  extractOpenClawUsage,
  extractOpenClawCost,
} from "./openclaw.js";

describe("extractOpenClawUsage", () => {
  it("maps cacheWrite → cacheCreate and preserves input/output/cacheRead", () => {
    const u = extractOpenClawUsage({
      usage: {
        input: 100,
        output: 50,
        cacheRead: 30,
        cacheWrite: 10,
        totalTokens: 190,
      },
    });
    expect(u).toEqual({
      input: 100,
      cacheCreate: 10,
      cacheRead: 30,
      output: 50,
    });
  });

  it("returns null when no usage present", () => {
    expect(extractOpenClawUsage({})).toBeNull();
    expect(extractOpenClawUsage(undefined)).toBeNull();
  });

  it("returns null when every field is zero", () => {
    expect(
      extractOpenClawUsage({
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ).toBeNull();
  });
});

describe("extractOpenClawCost", () => {
  it("returns the precomputed total cost when present", () => {
    expect(
      extractOpenClawCost({
        usage: { cost: { total: 0.069224 } },
      }),
    ).toBeCloseTo(0.069224);
  });

  it("returns null when cost is missing", () => {
    expect(extractOpenClawCost({ usage: {} })).toBeNull();
    expect(extractOpenClawCost({})).toBeNull();
  });
});
