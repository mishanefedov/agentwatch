import type { ServerResponse } from "node:http";
import type { AgentEvent, EventDetails } from "../schema.js";

/** Heartbeat cadence — below the usual 30–60 s idle-timeout on corporate
 *  proxies and the default nginx/haproxy `proxy_read_timeout`. Comment
 *  frames are ignored by EventSource clients but keep the TCP path warm. */
const HEARTBEAT_MS = 15_000;
const HEARTBEAT_FRAME = ": heartbeat\n\n";

/** Minimal SSE broadcaster: one writable raw response per client.
 *  Drops clients on write failure; no retry, no buffering.
 *
 *  Owns a single shared heartbeat interval — one timer for N clients.
 *  When a write fails (heartbeat or broadcast), the client is detached
 *  in one place. Previous design had a per-connection `setInterval` in
 *  the route handler that only cleared on the socket `close` event, so
 *  a broadcaster-detached zombie would keep ticking. */
export class SseBroadcaster {
  private clients = new Map<number, ServerResponse>();
  private nextId = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(intervalMs: number = HEARTBEAT_MS) {
    this.intervalMs = intervalMs;
  }

  attach(res: ServerResponse): number {
    const id = this.nextId++;
    this.clients.set(id, res);
    try {
      res.write(`event: hello\ndata: {"ok":true}\n\n`);
    } catch {
      this.clients.delete(id);
      return id;
    }
    this.ensureHeartbeat();
    return id;
  }

  detach(id: number): void {
    this.clients.delete(id);
    if (this.clients.size === 0) this.stopHeartbeat();
  }

  emitEvent(event: AgentEvent): void {
    this.broadcast("event", event);
  }

  emitEnrich(eventId: string, patch: Partial<EventDetails>): void {
    this.broadcast("enrich", { eventId, patch });
  }

  emitBudget(status: unknown): void {
    this.broadcast("budget", status);
  }

  emitAnomaly(sessionId: string, headline: string): void {
    this.broadcast("anomaly", { sessionId, headline });
  }

  /** Test hook: force a heartbeat tick without waiting on the timer. */
  pingForTest(): void {
    this.tick();
  }

  clientCount(): number {
    return this.clients.size;
  }

  private broadcast(kind: string, data: unknown): void {
    const payload = `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, res] of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(id);
      }
    }
    if (this.clients.size === 0) this.stopHeartbeat();
  }

  private tick(): void {
    for (const [id, res] of this.clients) {
      try {
        res.write(HEARTBEAT_FRAME);
      } catch {
        this.clients.delete(id);
      }
    }
    if (this.clients.size === 0) this.stopHeartbeat();
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.tick(), this.intervalMs);
    // Don't hold the event loop open for a broadcaster with no external
    // work — lets `process.exit()` on SIGINT actually exit.
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  closeAll(): void {
    this.stopHeartbeat();
    for (const res of this.clients.values()) {
      try {
        res.end();
      } catch {
        // fine
      }
    }
    this.clients.clear();
  }
}
