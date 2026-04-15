import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chokidar from "chokidar";
import type { AgentEvent, EventType } from "../schema.js";

/**
 * User-defined notification triggers. Lives in ~/.agentwatch/triggers.json
 * as an array of rule objects. Rules are compiled once on module load;
 * restart agentwatch to pick up edits.
 *
 * Example triggers.json:
 *   [
 *     { "match": "curl .* \\| bash", "title": "pipe-to-bash",
 *       "body": "{{agent}}: {{cmd}}" },
 *     { "type": "file_write", "pathMatch": "^/etc/", "title": "etc write",
 *       "body": "{{agent}} → {{path}}" }
 *   ]
 */

export interface UserTrigger {
  /** Regex tested against event.summary, event.cmd, event.path. */
  match?: string;
  /** Regex tested against event.path only (narrower than `match`). */
  pathMatch?: string;
  /** Limit rule to a specific event type (optional). */
  type?: EventType;
  /** Minimum per-turn cost to fire (USD). */
  thresholdUsd?: number;
  /** Notification title. `{{token}}` placeholders substituted from event. */
  title: string;
  /** Notification body. Same placeholder syntax. */
  body: string;
}

interface CompiledTrigger extends UserTrigger {
  matchRe?: RegExp;
  pathRe?: RegExp;
}

export const TRIGGERS_PATH = path.join(os.homedir(), ".agentwatch", "triggers.json");

let cached: CompiledTrigger[] | null = null;

/** Parse a raw triggers array. Exported for unit tests. */
export function compileTriggers(raw: unknown): CompiledTrigger[] {
  if (!Array.isArray(raw)) return [];
  const out: CompiledTrigger[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as UserTrigger;
    if (!r.title || !r.body) continue;
    const compiled: CompiledTrigger = { ...r };
    try {
      if (r.match) compiled.matchRe = new RegExp(r.match);
      if (r.pathMatch) compiled.pathRe = new RegExp(r.pathMatch);
    } catch {
      continue; // skip bad regex
    }
    out.push(compiled);
  }
  return out;
}

/** Load + compile the user's triggers file. Cached on first call. */
export function loadTriggers(): CompiledTrigger[] {
  if (cached !== null) return cached;
  try {
    const raw = fs.readFileSync(TRIGGERS_PATH, "utf8");
    cached = compileTriggers(JSON.parse(raw));
  } catch {
    cached = [];
  }
  return cached;
}

let watcher: ReturnType<typeof chokidar.watch> | null = null;

/** Start watching the triggers file so edits take effect without a
 *  restart. Idempotent. No-op until the user creates the file. */
export function watchTriggers(): () => void {
  if (watcher) return () => void watcher?.close();
  try {
    watcher = chokidar.watch(TRIGGERS_PATH, {
      persistent: true,
      ignoreInitial: true,
    });
    watcher.on("change", () => _resetTriggersCache());
    watcher.on("add", () => _resetTriggersCache());
    watcher.on("unlink", () => _resetTriggersCache());
    watcher.on("error", () => {
      /* swallow — triggers are a convenience, not load-bearing */
    });
  } catch {
    /* chokidar failed to spin up; run without live-reload */
  }
  return () => {
    void watcher?.close();
    watcher = null;
  };
}

/** Test helper — resets the cache so tests can load different configs. */
export function _resetTriggersCache(): void {
  cached = null;
}

/** Evaluate every trigger against an event, return the first match as a
 *  {title, body} pair with `{{token}}` placeholders substituted. */
export function evalTriggers(
  event: AgentEvent,
  triggers: CompiledTrigger[] = loadTriggers(),
): { title: string; body: string } | null {
  for (const t of triggers) {
    if (t.type && event.type !== t.type) continue;
    if (t.thresholdUsd != null) {
      const cost = event.details?.cost ?? 0;
      if (cost < t.thresholdUsd) continue;
    }
    if (t.pathRe) {
      if (!event.path || !t.pathRe.test(event.path)) continue;
    }
    if (t.matchRe) {
      const hay =
        `${event.summary ?? ""}\n${event.cmd ?? ""}\n${event.path ?? ""}`;
      if (!t.matchRe.test(hay)) continue;
    }
    // A rule with no match fields is a type-only / threshold-only rule —
    // that's fine; it fires on every matching event.
    return {
      title: expand(t.title, event),
      body: expand(t.body, event),
    };
  }
  return null;
}

function expand(tmpl: string, e: AgentEvent): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    switch (key) {
      case "agent": return e.agent;
      case "type": return e.type;
      case "cmd": return e.cmd ?? "";
      case "path": return e.path ?? "";
      case "tool": return e.tool ?? "";
      case "summary": return e.summary ?? "";
      case "cost":
        return e.details?.cost ? `$${e.details.cost.toFixed(4)}` : "";
      default: return "";
    }
  });
}
