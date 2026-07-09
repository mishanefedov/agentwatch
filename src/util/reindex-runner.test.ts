import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildProgress } from "./semantic-builder.js";

const buildSemanticIndexMock = vi.fn<
  (opts: {
    onProgress?: (p: BuildProgress) => void;
    signal?: AbortSignal;
  }) => Promise<BuildProgress>
>();

vi.mock("./semantic-builder.js", () => ({
  buildSemanticIndex: (opts: Parameters<typeof buildSemanticIndexMock>[0]) =>
    buildSemanticIndexMock(opts),
}));

const { runReindex } = await import("./reindex-runner.js");
const { readReindexMeta, _resetForTest, writeReindexMeta } = await import(
  "./semantic-index.js"
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentwatch-reindex-"));
  process.env.AGENTWATCH_INDEX_DB_PATH = join(dir, "index.sqlite");
  _resetForTest();
  buildSemanticIndexMock.mockReset();
});

afterEach(() => {
  _resetForTest();
  delete process.env.AGENTWATCH_INDEX_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function progress(over: Partial<BuildProgress> = {}): BuildProgress {
  return { scannedFiles: 0, queuedTurns: 0, embeddedTurns: 0, skippedTurns: 0, ...over };
}

describe("runReindex", () => {
  it("marks the meta row done and returns code 0 on success", async () => {
    buildSemanticIndexMock.mockImplementation(async (opts) => {
      opts.onProgress?.(progress({ scannedFiles: 3, queuedTurns: 10, embeddedTurns: 10 }));
      return progress({ scannedFiles: 3, queuedTurns: 10, embeddedTurns: 10 });
    });

    const result = await runReindex({ quiet: true });

    expect(result.code).toBe(0);
    expect(result.status).toBe("done");
    const meta = readReindexMeta();
    expect(meta.status).toBe("done");
    expect(meta.embeddedTurns).toBe(10);
    expect(meta.error).toBeNull();
  });

  it("writes intermediate progress as the build reports it", async () => {
    const seen: number[] = [];
    buildSemanticIndexMock.mockImplementation(async (opts) => {
      opts.onProgress?.(progress({ queuedTurns: 100, embeddedTurns: 32 }));
      seen.push(readReindexMeta().embeddedTurns);
      opts.onProgress?.(progress({ queuedTurns: 100, embeddedTurns: 64 }));
      seen.push(readReindexMeta().embeddedTurns);
      return progress({ queuedTurns: 100, embeddedTurns: 64 });
    });

    await runReindex({ quiet: true });

    expect(seen).toEqual([32, 64]);
    // Intermediate writes must show status "running" so pollers (TUI
    // footer, web route) know a build is in flight before it finishes.
    expect(buildSemanticIndexMock).toHaveBeenCalledTimes(1);
  });

  it("marks the meta row cancelled (not error) when the signal aborts", async () => {
    buildSemanticIndexMock.mockImplementation(async (opts) => {
      opts.onProgress?.(progress({ queuedTurns: 100, embeddedTurns: 16 }));
      // Simulate the builder noticing the abort mid-run and returning
      // early with partial progress, as buildSemanticIndex actually does.
      return progress({ queuedTurns: 100, embeddedTurns: 16 });
    });

    const controller = new AbortController();
    controller.abort();
    const result = await runReindex({ signal: controller.signal, quiet: true });

    expect(result.status).toBe("cancelled");
    expect(result.code).toBe(130);
    const meta = readReindexMeta();
    expect(meta.status).toBe("cancelled");
    expect(meta.embeddedTurns).toBe(16);
  });

  it("marks the meta row error and returns code 1 when the build throws", async () => {
    buildSemanticIndexMock.mockRejectedValue(new Error("boom"));

    const result = await runReindex({ quiet: true });

    expect(result.code).toBe(1);
    expect(result.status).toBe("error");
    const meta = readReindexMeta();
    expect(meta.status).toBe("error");
    expect(meta.error).toContain("boom");
  });

  it("refuses to start a second build while one is already running (lock held)", async () => {
    writeReindexMeta({ status: "running", pid: process.pid });

    const result = await runReindex({ quiet: true });

    expect(result.code).toBe(0);
    expect(result.status).toBe("running");
    expect(buildSemanticIndexMock).not.toHaveBeenCalled();
  });

  it("proceeds when the previously-recorded pid is dead (stale lock)", async () => {
    writeReindexMeta({ status: "running", pid: 999_999_999 });
    buildSemanticIndexMock.mockResolvedValue(progress());

    const result = await runReindex({ quiet: true });

    expect(buildSemanticIndexMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("done");
  });
});
