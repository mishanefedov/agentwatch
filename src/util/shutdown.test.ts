import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetShutdownForTest,
  onShutdown,
  runShutdownHooks,
} from "./shutdown.js";

describe("shutdown registry", () => {
  beforeEach(() => {
    _resetShutdownForTest();
  });

  it("runs hooks in LIFO order", async () => {
    const calls: number[] = [];
    onShutdown(() => {
      calls.push(1);
    });
    onShutdown(() => {
      calls.push(2);
    });
    onShutdown(() => {
      calls.push(3);
    });
    await runShutdownHooks();
    expect(calls).toEqual([3, 2, 1]);
  });

  it("continues when a hook throws", async () => {
    const calls: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    onShutdown(() => {
      calls.push("first");
    });
    onShutdown(() => {
      throw new Error("boom");
    });
    onShutdown(() => {
      calls.push("third");
    });
    await runShutdownHooks();
    expect(calls).toEqual(["third", "first"]);
    spy.mockRestore();
  });

  it("awaits async hooks", async () => {
    let done = false;
    onShutdown(async () => {
      await new Promise((r) => setTimeout(r, 5));
      done = true;
    });
    await runShutdownHooks();
    expect(done).toBe(true);
  });

  it("is idempotent on re-entry", async () => {
    let count = 0;
    onShutdown(() => {
      count += 1;
    });
    await Promise.all([runShutdownHooks(), runShutdownHooks()]);
    expect(count).toBe(1);
  });

  it("unregister removes a hook before it runs", async () => {
    let ran = false;
    const off = onShutdown(() => {
      ran = true;
    });
    off();
    await runShutdownHooks();
    expect(ran).toBe(false);
  });
});
