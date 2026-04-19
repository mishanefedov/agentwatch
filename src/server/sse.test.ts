import { describe, expect, it, vi } from "vitest";
import { SseBroadcaster } from "./sse.js";

function fakeRes(): {
  writes: string[];
  ended: boolean;
  write: (chunk: string) => void;
  end: () => void;
  throwOnNextWrite?: boolean;
} {
  const obj: ReturnType<typeof fakeRes> = {
    writes: [],
    ended: false,
    write(chunk: string) {
      if (this.throwOnNextWrite) {
        this.throwOnNextWrite = false;
        throw new Error("socket gone");
      }
      this.writes.push(chunk);
    },
    end() {
      this.ended = true;
    },
  };
  return obj;
}

describe("SseBroadcaster", () => {
  it("writes a hello frame on attach", () => {
    const b = new SseBroadcaster();
    const res = fakeRes();
    b.attach(res as unknown as import("node:http").ServerResponse);
    expect(res.writes[0]).toContain("event: hello");
    b.closeAll();
  });

  it("emits heartbeat frames to all attached clients", () => {
    const b = new SseBroadcaster();
    const a = fakeRes();
    const c = fakeRes();
    b.attach(a as unknown as import("node:http").ServerResponse);
    b.attach(c as unknown as import("node:http").ServerResponse);
    b.pingForTest();
    expect(a.writes.some((w) => w.includes(": heartbeat"))).toBe(true);
    expect(c.writes.some((w) => w.includes(": heartbeat"))).toBe(true);
    b.closeAll();
  });

  it("detaches clients whose heartbeat write throws", () => {
    const b = new SseBroadcaster();
    const good = fakeRes();
    const dead = fakeRes();
    b.attach(good as unknown as import("node:http").ServerResponse);
    b.attach(dead as unknown as import("node:http").ServerResponse);
    dead.throwOnNextWrite = true;
    b.pingForTest();
    expect(b.clientCount()).toBe(1);
    // subsequent broadcast only reaches the good client
    b.emitEvent({
      id: "x",
      ts: new Date().toISOString(),
      agent: "claude-code",
      type: "prompt",
      sessionId: "s",
      riskScore: 0,
    });
    expect(good.writes.some((w) => w.includes("event: event"))).toBe(true);
    b.closeAll();
  });

  it("stops the heartbeat timer when the last client detaches", () => {
    vi.useFakeTimers();
    try {
      const b = new SseBroadcaster(1_000);
      const res = fakeRes();
      const id = b.attach(res as unknown as import("node:http").ServerResponse);
      expect(b.clientCount()).toBe(1);
      b.detach(id);
      expect(b.clientCount()).toBe(0);
      // Advance past the interval — no new writes should land anywhere.
      const writesBefore = res.writes.length;
      vi.advanceTimersByTime(5_000);
      expect(res.writes.length).toBe(writesBefore);
    } finally {
      vi.useRealTimers();
    }
  });
});
