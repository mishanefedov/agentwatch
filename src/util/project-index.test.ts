import { describe, expect, it } from "vitest";
import { isStale, STALE_MS } from "./project-index.js";

describe("isStale", () => {
  const now = Date.parse("2026-04-15T12:00:00Z");

  it("returns false for an event inside the stale window", () => {
    const fresh = new Date(now - STALE_MS + 1000).toISOString();
    expect(isStale(fresh, now)).toBe(false);
  });

  it("returns true for an event past the stale window", () => {
    const old = new Date(now - STALE_MS - 1).toISOString();
    expect(isStale(old, now)).toBe(true);
  });

  it("returns false for a just-now event", () => {
    expect(isStale(new Date(now).toISOString(), now)).toBe(false);
  });
});
