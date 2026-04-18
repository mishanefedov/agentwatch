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
import { registerConfigRoutes } from "./routes/config.js";
import { registerTrendsRoutes } from "./routes/trends.js";
import { registerDiffRoutes } from "./routes/diffs.js";
import { registerReplayRoutes } from "./routes/replay.js";

export interface ServerHandle {
  url: string;
  broadcaster: SseBroadcaster;
  events: AgentEvent[]; // shared in-memory ring, newest-first
  stop: () => Promise<void>;
}

export interface StartServerOptions {
  host?: string;
  port?: number;
  events: AgentEvent[]; // owned by the caller (TUI reducer), we only read
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3456;

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

  const app = Fastify({ logger: false });

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
  app.get("/api/health", async () => ({ ok: true, version: "0.0.3" }));

  // SSE stream
  app.get("/api/events/stream", async (req, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();
    const clientId = broadcaster.attach(reply.raw);
    // Send a heartbeat every 15s so proxies don't kill idle conns.
    const hb = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        // client gone
      }
    }, 15_000);
    req.raw.on("close", () => {
      clearInterval(hb);
      broadcaster.detach(clientId);
    });
    // Keep the handler alive until the socket closes.
    return reply;
  });

  registerEventRoutes(app, opts.events);
  registerProjectRoutes(app, opts.events);
  registerSessionRoutes(app, opts.events);
  registerAgentRoutes(app, opts.events);
  registerPermissionRoutes(app);
  registerCronRoutes(app, opts.events);
  registerSearchRoutes(app, opts.events);
  registerConfigRoutes(app);
  registerTrendsRoutes(app, opts.events);
  registerDiffRoutes(app, opts.events);
  registerReplayRoutes(app, opts.events);

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

  return {
    url,
    broadcaster,
    events: opts.events,
    stop: async () => {
      broadcaster.closeAll();
      await app.close();
    },
  };
}
