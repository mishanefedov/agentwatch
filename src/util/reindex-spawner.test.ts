import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReindexMeta } from "./semantic-index.js";

const spawnMock = vi.fn();
const unrefMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => {
    spawnMock(...args);
    return { unref: unrefMock };
  },
}));

const { spawnDetachedReindex, shouldSpawnReindex, cancelReindex } = await import(
  "./reindex-spawner.js"
);

function meta(over: Partial<ReindexMeta> = {}): ReindexMeta {
  return {
    status: "idle",
    pid: null,
    startedAt: null,
    updatedAt: null,
    scannedFiles: 0,
    queuedTurns: 0,
    embeddedTurns: 0,
    skippedTurns: 0,
    error: null,
    ...over,
  };
}

describe("spawnDetachedReindex", () => {
  beforeEach(() => {
    spawnMock.mockClear();
    unrefMock.mockClear();
  });

  it("spawns detached + ignores stdio, then unrefs the child", () => {
    spawnDetachedReindex();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, , opts] = spawnMock.mock.calls[0]!;
    expect(opts).toMatchObject({ detached: true, stdio: "ignore" });
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });

  it("passes 'reindex' as the final CLI arg", () => {
    spawnDetachedReindex();
    const [, args] = spawnMock.mock.calls[0]!;
    expect((args as string[]).at(-1)).toBe("reindex");
  });
});

describe("shouldSpawnReindex", () => {
  it("spawns on first run (no index yet)", () => {
    expect(shouldSpawnReindex(meta(), false, 0)).toBe(true);
  });

  it("spawns when the index exists but has zero vectors", () => {
    expect(shouldSpawnReindex(meta({ status: "done" }), true, 0)).toBe(true);
  });

  it("does not spawn while a live pid is already running", () => {
    const running = meta({ status: "running", pid: process.pid });
    expect(shouldSpawnReindex(running, true, 100)).toBe(false);
  });

  it("spawns if the recorded 'running' pid is actually dead (stale lock)", () => {
    const stale = meta({ status: "running", pid: 999_999_999 });
    expect(shouldSpawnReindex(stale, true, 100)).toBe(true);
  });

  it("does not spawn when a fresh build just finished", () => {
    const fresh = meta({ status: "done", updatedAt: new Date().toISOString() });
    expect(shouldSpawnReindex(fresh, true, 100)).toBe(false);
  });

  it("spawns again once the last build is stale", () => {
    const old = meta({
      status: "done",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect(shouldSpawnReindex(old, true, 100)).toBe(true);
  });
});

describe("cancelReindex", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when there's no pid to cancel", () => {
    expect(cancelReindex(meta({ status: "idle", pid: null }))).toBe(false);
  });

  it("returns false when the pid is already dead", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("no such process") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    expect(cancelReindex(meta({ status: "running", pid: 999_999_999 }))).toBe(false);
  });

  it("sends SIGTERM to a live pid and reports success", () => {
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((pid: number, signal?: string | number) => {
        // Signal 0 is the liveness probe used by isPidAlive; anything else
        // is the real cancel signal we're asserting on.
        if (signal === 0) return true;
        expect(pid).toBe(process.pid);
        expect(signal).toBe("SIGTERM");
        return true;
      });
    expect(cancelReindex(meta({ status: "running", pid: process.pid }))).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
  });
});
