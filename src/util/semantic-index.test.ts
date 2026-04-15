import { describe, expect, it } from "vitest";
import { rrfFuse } from "./semantic-index.js";

describe("rrfFuse", () => {
  it("prefers documents that appear in both rankings", () => {
    const bm = [
      { id: "a", rank: 1 },
      { id: "b", rank: 2 },
      { id: "c", rank: 3 },
    ];
    const vec = [
      { id: "b", rank: 1 },
      { id: "a", rank: 2 },
      { id: "d", rank: 3 },
    ];
    const fused = rrfFuse([{ hits: bm }, { hits: vec }], 60, 10);
    // a and b appear in both; c and d only in one.
    const top2 = fused.slice(0, 2).map((r) => r.id);
    expect(top2).toContain("a");
    expect(top2).toContain("b");
    expect(fused.find((r) => r.id === "c")?.sources.size).toBe(1);
    expect(fused.find((r) => r.id === "d")?.sources.size).toBe(1);
  });

  it("respects the k parameter (larger k flattens the curve)", () => {
    const bm = [{ id: "a", rank: 1 }];
    const k10 = rrfFuse([{ hits: bm }], 10)[0]!.score;
    const k60 = rrfFuse([{ hits: bm }], 60)[0]!.score;
    expect(k10).toBeGreaterThan(k60);
  });

  it("drops to empty when no inputs", () => {
    expect(rrfFuse([])).toEqual([]);
  });

  it("caps output at limit", () => {
    const hits = Array.from({ length: 20 }, (_, i) => ({
      id: `id${i}`,
      rank: i + 1,
    }));
    const fused = rrfFuse([{ hits }], 60, 5);
    expect(fused).toHaveLength(5);
  });
});
