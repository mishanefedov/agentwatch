import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _resetForTest,
  claimReindexLock,
  isPidAlive,
  readReindexMeta,
  rrfFuse,
  writeReindexMeta,
} from "./semantic-index.js";

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

describe("reindex progress + lock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentwatch-index-"));
    process.env.AGENTWATCH_INDEX_DB_PATH = join(dir, "index.sqlite");
    _resetForTest();
  });

  afterEach(() => {
    _resetForTest();
    delete process.env.AGENTWATCH_INDEX_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to idle before any build has run", () => {
    const meta = readReindexMeta();
    expect(meta.status).toBe("idle");
    expect(meta.pid).toBeNull();
    expect(meta.embeddedTurns).toBe(0);
  });

  it("round-trips a written progress patch", () => {
    writeReindexMeta({
      status: "running",
      pid: 12345,
      scannedFiles: 10,
      queuedTurns: 100,
      embeddedTurns: 32,
    });
    const meta = readReindexMeta();
    expect(meta.status).toBe("running");
    expect(meta.pid).toBe(12345);
    expect(meta.scannedFiles).toBe(10);
    expect(meta.queuedTurns).toBe(100);
    expect(meta.embeddedTurns).toBe(32);
  });

  it("merges partial patches instead of clobbering unset fields", () => {
    writeReindexMeta({ status: "running", pid: 1, queuedTurns: 50 });
    writeReindexMeta({ embeddedTurns: 20 });
    const meta = readReindexMeta();
    expect(meta.status).toBe("running");
    expect(meta.pid).toBe(1);
    expect(meta.queuedTurns).toBe(50);
    expect(meta.embeddedTurns).toBe(20);
  });

  it("isPidAlive is true for the current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("isPidAlive is false for a pid that doesn't exist", () => {
    // A pid this large is never a real process.
    expect(isPidAlive(999_999_999)).toBe(false);
  });

  it("claimReindexLock acquires the slot when idle", () => {
    const claim = claimReindexLock();
    expect(claim.acquired).toBe(true);
    expect(claim.meta.pid).toBe(process.pid);
    expect(readReindexMeta().status).toBe("running");
  });

  it("claimReindexLock refuses a second claim while one is alive", () => {
    const first = claimReindexLock();
    expect(first.acquired).toBe(true);
    const second = claimReindexLock();
    expect(second.acquired).toBe(false);
    expect(second.meta.pid).toBe(process.pid);
  });

  it("claimReindexLock recovers a stale lock from a dead pid", () => {
    writeReindexMeta({ status: "running", pid: 999_999_999 });
    const claim = claimReindexLock();
    expect(claim.acquired).toBe(true);
    expect(claim.meta.pid).toBe(process.pid);
  });

  it("claimReindexLock re-acquires after a previous build finished", () => {
    writeReindexMeta({ status: "done", pid: 1, embeddedTurns: 10 });
    const claim = claimReindexLock();
    expect(claim.acquired).toBe(true);
    // The new claim resets counters for the fresh run.
    expect(claim.meta.embeddedTurns).toBe(0);
  });
});
