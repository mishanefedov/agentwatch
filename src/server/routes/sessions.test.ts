import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { AgentEvent } from "../../schema.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerProjectRoutes } from "./projects.js";
import { openStore } from "../../store/sqlite.js";
import type { EventStore } from "../../store/sqlite.js";

describe("SQLite migration routes", () => {
  let app: ReturnType<typeof Fastify>;
  let store: EventStore;

  beforeEach(() => {
    app = Fastify();
    store = openStore({ dbPath: ":memory:" });
  });

  afterEach(async () => {
    store.close();
    await app.close();
  });

  it("GET /api/sessions/:id returns events from store (even if not in memory)", async () => {
    const memoryEvents: AgentEvent[] = []; // empty memory buffer!

    const oldEvent: AgentEvent = {
      id: "ev1",
      sessionId: "s1",
      agent: "claude-code",
      ts: "2023-01-01T00:00:00Z",
      type: "prompt",
      summary: "Hello",
      riskScore: 0,
    };
    store.insert(oldEvent);

    registerSessionRoutes(app, memoryEvents, store);

    const res = await app.inject({
      method: "GET",
      url: "/api/sessions/s1",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.sessionId).toBe("s1");
    expect(json.events).toHaveLength(1);
    expect(json.events[0].id).toBe("ev1");
  });

  it("GET /api/projects/:name/sessions returns sessions from store", async () => {
    const memoryEvents: AgentEvent[] = [];

    const oldEvent: AgentEvent = {
      id: "ev1",
      sessionId: "s1",
      agent: "claude-code",
      ts: "2023-01-01T00:00:00Z",
      type: "prompt",
      summary: "[myproj] Hello",
      riskScore: 0,
    };
    store.insert(oldEvent);

    registerProjectRoutes(app, memoryEvents, store);

    const res = await app.inject({
      method: "GET",
      url: "/api/projects/myproj/sessions",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.project).toBe("myproj");
    expect(json.sessions).toHaveLength(1);
    expect(json.sessions[0].sessionId).toBe("s1");
    expect(json.sessions[0].eventCount).toBe(1);
  });
});
