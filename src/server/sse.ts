import type { ServerResponse } from "node:http";
import type { AgentEvent, EventDetails } from "../schema.js";

/** Minimal SSE broadcaster: one writable raw response per client.
 *  Drops clients on write failure; no retry, no buffering. */
export class SseBroadcaster {
  private clients = new Map<number, ServerResponse>();
  private nextId = 0;

  attach(res: ServerResponse): number {
    const id = this.nextId++;
    this.clients.set(id, res);
    // Send a hello so the client can confirm the stream is live.
    try {
      res.write(`event: hello\ndata: {"ok":true}\n\n`);
    } catch {
      this.clients.delete(id);
    }
    return id;
  }

  detach(id: number): void {
    this.clients.delete(id);
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

  private broadcast(kind: string, data: unknown): void {
    const payload = `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, res] of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  closeAll(): void {
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
