import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifySessionKey, readCronJobs } from "./openclaw-cron.js";

describe("readCronJobs", () => {
  it("returns [] when the jobs file is missing", () => {
    expect(readCronJobs("/tmp/this-does-not-exist.json")).toEqual([]);
  });

  it("parses a real `every` job (matches openclaw cron add --json output)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ocron-"));
    const file = path.join(tmp, "jobs.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        jobs: [
          {
            id: "abc-123",
            agentId: "content",
            name: "demo",
            enabled: true,
            schedule: { kind: "every", everyMs: 300_000, anchorMs: 1 },
            sessionTarget: "isolated",
            wakeMode: "now",
            payload: { kind: "agentTurn", message: "test" },
            delivery: { mode: "announce", channel: "last" },
            state: { nextRunAtMs: 1776341493440 },
          },
        ],
      }),
    );
    const jobs = readCronJobs(file);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: "abc-123",
      agentId: "content",
      name: "demo",
      enabled: true,
      schedule: "every 5m",
      scheduleKind: "every",
      intervalMs: 300_000,
      nextRunAtMs: 1776341493440,
      message: "test",
      deliveryChannel: "last",
    });
    fs.rmSync(tmp, { recursive: true });
  });

  it("ignores entries missing required fields", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ocron-"));
    const file = path.join(tmp, "jobs.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ jobs: [{ name: "no id" }, { id: "x", name: "ok" }] }),
    );
    expect(readCronJobs(file)).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe("classifySessionKey", () => {
  it("returns null for ordinary interactive session keys", () => {
    expect(classifySessionKey("agent:content:main", undefined)).toBeNull();
    expect(
      classifySessionKey("agent:content:main", { origin: { provider: "user" } }),
    ).toBeNull();
  });

  it("flags heartbeat sessions via origin.provider", () => {
    const m = classifySessionKey("agent:content:main", {
      origin: { provider: "heartbeat" },
    });
    expect(m).toEqual({ kind: "heartbeat", agentId: "content" });
  });

  it("flags cron-spawned sessions via the :cron: key fragment", () => {
    const m = classifySessionKey(
      "agent:content:cron:abc-123-def",
      undefined,
    );
    expect(m).toEqual({
      kind: "cron",
      agentId: "content",
      jobId: "abc-123-def",
      runId: undefined,
    });
  });

  it("captures runId for per-run cron session keys", () => {
    const m = classifySessionKey(
      "agent:content:cron:abc-123:run:run-xyz",
      undefined,
    );
    expect(m).toEqual({
      kind: "cron",
      agentId: "content",
      jobId: "abc-123",
      runId: "run-xyz",
    });
  });
});
