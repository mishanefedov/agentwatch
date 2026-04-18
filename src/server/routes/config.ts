import type { FastifyInstance } from "fastify";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const CONFIG_DIR = join(homedir(), ".agentwatch");
const PATHS = {
  budgets: join(CONFIG_DIR, "budgets.json"),
  anomaly: join(CONFIG_DIR, "anomaly.json"),
  triggers: join(CONFIG_DIR, "triggers.json"),
} as const;

type ConfigKind = keyof typeof PATHS;

const DEFAULTS: Record<ConfigKind, unknown> = {
  budgets: { perSessionUsd: null, perDayUsd: null },
  anomaly: { zScore: 3.5, loopWindow: 20, loopMinRepeats: 3, minSamples: 8 },
  triggers: [],
};

function readConfig(kind: ConfigKind): unknown {
  const p = PATHS[kind];
  if (!existsSync(p)) return DEFAULTS[kind];
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return DEFAULTS[kind];
  }
}

function writeConfig(kind: ConfigKind, value: unknown): void {
  const p = PATHS[kind];
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(value, null, 2), "utf8");
}

function validate(kind: ConfigKind, value: unknown): { ok: true } | { ok: false; error: string } {
  if (kind === "budgets") {
    if (typeof value !== "object" || value == null) return { ok: false, error: "budgets must be an object" };
    const v = value as Record<string, unknown>;
    for (const k of ["perSessionUsd", "perDayUsd"]) {
      const n = v[k];
      if (n != null && typeof n !== "number") return { ok: false, error: `${k} must be number or null` };
    }
    return { ok: true };
  }
  if (kind === "anomaly") {
    if (typeof value !== "object" || value == null) return { ok: false, error: "anomaly must be an object" };
    const v = value as Record<string, unknown>;
    for (const k of ["zScore", "loopWindow", "loopMinRepeats", "minSamples"]) {
      if (v[k] != null && typeof v[k] !== "number") return { ok: false, error: `${k} must be number` };
    }
    return { ok: true };
  }
  if (kind === "triggers") {
    if (!Array.isArray(value)) return { ok: false, error: "triggers must be an array" };
    for (let i = 0; i < value.length; i++) {
      const t = value[i] as Record<string, unknown>;
      if (typeof t !== "object" || t == null) return { ok: false, error: `triggers[${i}] must be an object` };
      if (!t.title || !t.body)
        return { ok: false, error: `triggers[${i}] requires title + body` };
    }
    return { ok: true };
  }
  return { ok: false, error: "unknown config kind" };
}

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get<{ Params: { kind: string } }>("/api/config/:kind", async (req, reply) => {
    const kind = req.params.kind as ConfigKind;
    if (!(kind in PATHS)) {
      reply.code(404);
      return { error: `unknown kind: ${kind}` };
    }
    return {
      kind,
      path: PATHS[kind],
      value: readConfig(kind),
      defaults: DEFAULTS[kind],
    };
  });

  app.put<{ Params: { kind: string }; Body: unknown }>(
    "/api/config/:kind",
    async (req, reply) => {
      const kind = req.params.kind as ConfigKind;
      if (!(kind in PATHS)) {
        reply.code(404);
        return { error: `unknown kind: ${kind}` };
      }
      const v = validate(kind, req.body);
      if (!v.ok) {
        reply.code(400);
        return { error: v.error };
      }
      writeConfig(kind, req.body);
      return { ok: true, kind, value: req.body };
    },
  );
}
