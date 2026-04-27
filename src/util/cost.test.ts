import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _resetPricingCache,
  costOf,
  formatUSD,
  loadRates,
  parseUsage,
} from "./cost.js";

const ENV = "AGENTWATCH_PRICING_PATH";
const DEBUG_ENV = "AGENTWATCH_PRICING_DEBUG";

function withPricingFile(json: object): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-pricing-"));
  const path = join(dir, "pricing.json");
  writeFileSync(path, JSON.stringify(json));
  return path;
}

describe("costOf + loadRates", () => {
  const original = process.env[ENV];

  beforeEach(() => {
    _resetPricingCache();
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
    delete process.env[DEBUG_ENV];
    _resetPricingCache();
  });

  it("falls back to baked-in defaults when no pricing file exists", () => {
    process.env[ENV] = "/nonexistent/agentwatch-pricing.json";
    const cost = costOf("claude-sonnet-4-6", {
      input: 1_000_000,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
    });
    expect(cost).toBeCloseTo(3.0, 5);
  });

  it("AUR-216: an entry in the user pricing file overrides the default for that model", () => {
    process.env[ENV] = withPricingFile({
      "claude-sonnet-4-6": {
        input: 999.0,
        cacheCreate: 0,
        cacheRead: 0,
        output: 0,
      },
    });
    const cost = costOf("claude-sonnet-4-6", {
      input: 1_000_000,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
    });
    expect(cost).toBeCloseTo(999.0, 5);
  });

  it("preserves defaults for models the user file does not mention", () => {
    process.env[ENV] = withPricingFile({
      "my-experimental": {
        input: 0,
        cacheCreate: 0,
        cacheRead: 0,
        output: 0,
      },
    });
    // claude-sonnet-4-6 was not overridden — still $3/M input.
    const cost = costOf("claude-sonnet-4-6", {
      input: 1_000_000,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
    });
    expect(cost).toBeCloseTo(3.0, 5);
    // The new model is now priced (and cheap).
    const c2 = costOf("my-experimental", {
      input: 5_000_000,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
    });
    expect(c2).toBe(0);
  });

  it("drops invalid entries (missing field, negative, wrong type)", () => {
    process.env[ENV] = withPricingFile({
      "claude-opus-4-6": {
        input: -1,
        cacheCreate: 0,
        cacheRead: 0,
        output: 0,
      },
      "claude-sonnet-4-6": {
        input: 5,
        cacheCreate: 0,
        cacheRead: 0,
        // missing output
      },
      "claude-haiku-4-5": "not-an-object",
    });
    const rates = loadRates();
    // Defaults survived because all three overrides were rejected.
    expect(rates["claude-opus-4-6"]?.input).toBe(15.0);
    expect(rates["claude-sonnet-4-6"]?.input).toBe(3.0);
    expect(rates["claude-haiku-4-5"]?.input).toBe(1.0);
  });

  it("normalizes model variants (gpt-5.4 → gpt-5, gemini-2.5-pro-preview → gemini-2.5-pro)", () => {
    const a = costOf("gpt-5.4-preview", {
      input: 1_000_000,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
    });
    const b = costOf("gpt-5", {
      input: 1_000_000,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
    });
    expect(a).toBeCloseTo(b, 5);
  });

  it("falls back to default rates for unknown models", () => {
    const cost = costOf("totally-unknown-model", {
      input: 1_000_000,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
    });
    // default.input is 3.0 (sonnet-equivalent fallback).
    expect(cost).toBeCloseTo(3.0, 5);
  });
});

describe("formatUSD", () => {
  it("uses adaptive precision based on magnitude", () => {
    expect(formatUSD(0)).toBe("$0");
    expect(formatUSD(0.001)).toBe("$0.0010");
    expect(formatUSD(0.5)).toBe("$0.500");
    expect(formatUSD(12.4)).toBe("$12.40");
  });
});

describe("parseUsage", () => {
  it("returns the four-field object when all keys are present", () => {
    const u = parseUsage({
      input_tokens: 10,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 100,
      output_tokens: 50,
    });
    expect(u).toEqual({
      input: 10,
      cacheCreate: 5,
      cacheRead: 100,
      output: 50,
    });
  });

  it("returns null when nothing useful is present", () => {
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage({})).toBeNull();
    expect(
      parseUsage({
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      }),
    ).toBeNull();
  });
});
