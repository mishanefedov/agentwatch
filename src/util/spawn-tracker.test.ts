import { beforeEach, describe, expect, it } from "vitest";
import {
  _pendingSpawns,
  _resetSpawnTracker,
  consumeSpawn,
  registerSpawn,
} from "./spawn-tracker.js";

describe("spawn-tracker", () => {
  beforeEach(() => _resetSpawnTracker());

  it("links a registered spawn when the child agent matches", () => {
    registerSpawn({
      parentEventId: "p1",
      callee: "codex",
      cwd: "/tmp/work",
      registeredMs: 1_000,
    });
    const hit = consumeSpawn("codex", "/tmp/work", 5_000);
    expect(hit?.parentEventId).toBe("p1");
  });

  it("returns null when the callee differs", () => {
    registerSpawn({
      parentEventId: "p1",
      callee: "codex",
      cwd: "/tmp/work",
      registeredMs: 1_000,
    });
    expect(consumeSpawn("gemini", "/tmp/work", 5_000)).toBeNull();
  });

  it("returns null when the cwd differs", () => {
    registerSpawn({
      parentEventId: "p1",
      callee: "codex",
      cwd: "/tmp/a",
      registeredMs: 1_000,
    });
    expect(consumeSpawn("codex", "/tmp/b", 5_000)).toBeNull();
  });

  it("treats an empty cwd as a wildcard (Gemini chat-json fallback)", () => {
    registerSpawn({
      parentEventId: "p1",
      callee: "gemini",
      cwd: "/tmp/work",
      registeredMs: 1_000,
    });
    // Gemini child sessions don't carry cwd; we match on callee alone.
    expect(consumeSpawn("gemini", "", 5_000)?.parentEventId).toBe("p1");
  });

  it("matches when cwds are prefix-related (subdirectory case)", () => {
    registerSpawn({
      parentEventId: "p1",
      callee: "codex",
      cwd: "/tmp/work",
      registeredMs: 1_000,
    });
    // Child reports a subdir of the parent's cwd.
    expect(
      consumeSpawn("codex", "/tmp/work/subdir", 5_000)?.parentEventId,
    ).toBe("p1");
  });

  it("removes the matched spawn so a second child doesn't double-link", () => {
    registerSpawn({
      parentEventId: "p1",
      callee: "codex",
      cwd: "/tmp/work",
      registeredMs: 1_000,
    });
    expect(consumeSpawn("codex", "/tmp/work", 5_000)?.parentEventId).toBe("p1");
    expect(consumeSpawn("codex", "/tmp/work", 5_000)).toBeNull();
  });

  it("drops entries older than the 60s TTL", () => {
    registerSpawn({
      parentEventId: "p1",
      callee: "codex",
      cwd: "/tmp/work",
      registeredMs: 0,
    });
    // 61 seconds later — out of TTL.
    expect(consumeSpawn("codex", "/tmp/work", 61_000)).toBeNull();
  });

  it("returns the most recent match when multiple parents are pending", () => {
    registerSpawn({
      parentEventId: "p1",
      callee: "codex",
      cwd: "/tmp/work",
      registeredMs: 1_000,
    });
    registerSpawn({
      parentEventId: "p2",
      callee: "codex",
      cwd: "/tmp/work",
      registeredMs: 2_000,
    });
    expect(consumeSpawn("codex", "/tmp/work", 3_000)?.parentEventId).toBe("p2");
    expect(consumeSpawn("codex", "/tmp/work", 3_000)?.parentEventId).toBe("p1");
  });

  it("prunes the buffer once it exceeds the size cap", () => {
    for (let i = 0; i < 250; i++) {
      registerSpawn({
        parentEventId: `p${i}`,
        callee: "codex",
        cwd: "/tmp/work",
        registeredMs: i,
      });
    }
    expect(_pendingSpawns().length).toBeLessThanOrEqual(200);
  });
});
