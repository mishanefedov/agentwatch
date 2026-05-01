import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { AgentEvent } from "../schema.js";
import { SseBroadcaster } from "./sse.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerPermissionRoutes } from "./routes/permissions.js";
import { registerCronRoutes } from "./routes/cron.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerYieldRoutes } from "./routes/yield.js";
import { registerActivityRoutes } from "./routes/activity.js";
import type { EventStore } from "../store/sqlite.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerTrendsRoutes } from "./routes/trends.js";
import { registerDiffRoutes } from "./routes/diffs.js";
import { registerReplayRoutes } from "./routes/replay.js";
import { VERSION } from "../util/version.js";

/**
 * Per-agent cap — each agent's bucket is bounded, so one chatty agent
 * (claude-code emits ~50k events on boot backfill) can't evict smaller
 * but equally interesting agents (gemini, codex, openclaw, hermes).
 */
const PER_AGENT_CAP = 10_000;

export interface ServerHandle {
  url: string;
  broadcaster: SseBroadcaster;
  /** Per-agent buckets; oldest-first within each. */
  byAgent: Map<string, AgentEvent[]>;
  /** Flat merged view for callers expecting one array. Rebuilt lazily. */
  events: AgentEvent[];
  /** Rebuild `events` from `byAgent`. Cheap enough at our scale. */
  rebuildFlat: () => void;
  /** Persistent SQLite store, if one was passed at startup. Routes that
   *  need full history (e.g. search history mode) read from this; the
   *  in-memory ring buffer remains the source of truth for the SSE live
   *  stream. */
  store?: EventStore;
  stop: () => Promise<void>;
}

export interface StartServerOptions {
  host?: string;
  port?: number;
  events?: AgentEvent[]; // optional; kept for back-compat
  store?: EventStore;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3456;

/** Add an event into a per-agent bucket + mark the flat view dirty.
 *  The flat array is rebuilt lazily on the next API request — that
 *  defers the O(n log n) sort out of the hot emit path. */
export function addEventToServer(handle: ServerHandle, e: AgentEvent): void {
  let bucket = handle.byAgent.get(e.agent);
  if (!bucket) {
    bucket = [];
    handle.byAgent.set(e.agent, bucket);
  }
  bucket.push(e);
  if (bucket.length > PER_AGENT_CAP) {
    bucket.splice(0, 1_000);
  }
  // Invalidate — flat array will be rebuilt lazily.
  (handle as { flatDirty?: boolean }).flatDirty = true;
}

/** Resolve the web bundle directory.
 *  After production build: dist/index.js → dist/web/ (sibling).
 *  Dev (tsx from src/server/index.ts): walk two levels up → dist/web/
 *  (built once by `npm run build:web` during dev). */
function resolveWebDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "web"),                        // built: dist/index.js → dist/web
    join(here, "..", "dist", "web"),          // dev: src/server → dist/web
    join(here, "..", "..", "dist", "web"),    // nested fallback
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  const broadcaster = new SseBroadcaster();

  const byAgent = new Map<string, AgentEvent[]>();
  const events: AgentEvent[] = opts.events ?? [];

  function rebuildFlat(): void {
    events.length = 0;
    for (const bucket of byAgent.values()) {
      for (const e of bucket) events.push(e);
    }
    events.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  }

  let handle: ServerHandle | null = null;

  const app = Fastify({ logger: false });

  // Rebuild flat view on every API request that actually reads events.
  // Per-request cost is O(n) merge + O(n log n) sort — ~5ms at 10k
  // events, invisible in user latency.
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/events/stream") return; // SSE doesn't read flat
    const dirty = (handle as { flatDirty?: boolean } | null)?.flatDirty;
    if (dirty !== false) {
      rebuildFlat();
      if (handle) (handle as { flatDirty?: boolean }).flatDirty = false;
    }
  });

  // CORS for dev: allow localhost:5173 (Vite) to hit us during development.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    return payload;
  });
  app.options("/*", async (_req, reply) => {
    reply.code(204).send();
  });

  // Health + version
  app.get("/api/health", async () => ({ ok: true, version: VERSION }));

  // SSE stream
  app.get("/api/events/stream", async (req, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();
    const clientId = broadcaster.attach(reply.raw);
    // Heartbeat is owned by the broadcaster — a single tick for N clients
    // that shares dead-socket detection with `broadcast()`.
    req.raw.on("close", () => broadcaster.detach(clientId));
    // Keep the handler alive until the socket closes.
    return reply;
  });

  registerEventRoutes(app, events);
  registerProjectRoutes(app, events);
  registerSessionRoutes(app, events);
  registerAgentRoutes(app, events, byAgent);
  registerPermissionRoutes(app);
  registerCronRoutes(app, events);
  registerSearchRoutes(app, events, opts.store);
  registerYieldRoutes(app, opts.store);
  registerActivityRoutes(app, opts.store);
  registerConfigRoutes(app);
  registerTrendsRoutes(app, events);
  registerDiffRoutes(app, events);
  registerReplayRoutes(app, events);

  // Static web bundle (if built).
  const webDist = resolveWebDist();
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/" });
    // SPA fallback — any unknown route serves index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      message:
        "agentwatch web UI bundle not built — run `npm run build:web` or `npm run dev:web` to develop",
    }));
  }

  await app.listen({ host, port });
  const url = `http://${host}:${port}`;

  handle = {
    url,
    broadcaster,
    byAgent,
    events,
    rebuildFlat,
    store: opts.store,
    stop: async () => {
      broadcaster.closeAll();
      await app.close();
    },
  };
  return handle;
}
