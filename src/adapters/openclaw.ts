import chokidar from "chokidar";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, join, sep } from "node:path";
import { homedir } from "node:os";
import type { AgentEvent, EventType } from "../schema.js";
import { clampTs, riskOf } from "../schema.js";
import { nextId } from "../util/ids.js";
import {
  classifySessionKey,
  type ScheduledMarker,
} from "../util/openclaw-cron.js";

import type { EventSink } from "../schema.js";

type Emit = EventSink | ((e: AgentEvent) => void);

interface FileCursor {
  offset: number;
}

// Shared across adapter lifetime: session_start entries tell us the cwd,
// later messages in the same session inherit it so we can tag events
// with a project label.
const sessionCwd = new Map<string, string>();

// AUR-205/206: cache (sessionId → ScheduledMarker) so events from a
// cron-spawned or heartbeat-triggered session pick up `details.scheduled`.
// Filled lazily by reading each agent's sessions.json the first time
// we touch one of its session files.
const scheduledBySessionId = new Map<string, ScheduledMarker>();
const sessionsJsonRead = new Set<string>();

function loadScheduledMarkers(file: string): void {
  // Resolve to .../agents/<agentId>/sessions/sessions.json
  const dir = file.split(sep).slice(0, -1).join(sep);
  const jsonPath = join(dir, "sessions.json");
  if (sessionsJsonRead.has(jsonPath)) return;
  sessionsJsonRead.add(jsonPath);
  let raw: string;
  try {
    raw = readFileSync(jsonPath, "utf8");
  } catch {
    return;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return;
  }
  if (!doc || typeof doc !== "object") return;
  for (const [sessionKey, entryRaw] of Object.entries(
    doc as Record<string, unknown>,
  )) {
    const entry = (entryRaw ?? {}) as Record<string, unknown>;
    const marker = classifySessionKey(sessionKey, entry);
    if (!marker) continue;
    const sid = entry.sessionId;
    if (typeof sid === "string") scheduledBySessionId.set(sid, marker);
  }
}

export function _resetOpenClawScheduledCache(): void {
  scheduledBySessionId.clear();
  sessionsJsonRead.clear();
}

export function startOpenClawAdapter(sink: Emit): () => void {
  const emit = typeof sink === "function" ? sink : sink.emit;
  const root = join(homedir(), ".openclaw");
  if (!existsSync(root)) return () => {};

  const cursors = new Map<string, FileCursor>();
  const stoppers: Array<() => void> = [];

  // 1) Per-sub-agent session JSONL streams.
  // chokidar v4 dropped glob support; we watch agents/ recursively and filter.
  const agentsDir = join(root, "agents");
  const sessionRe = /[\\/]agents[\\/][^\\/]+[\\/]sessions[\\/][^\\/]+\.jsonl$/;
  const sessionsWatcher = chokidar.watch(agentsDir, {
    persistent: true,
    ignoreInitial: false,
    depth: 4,
    ignored: (p) => /\.reset\./.test(p),
  });
  const handleSession = (f: string, initial: boolean) => {
    if (!sessionRe.test(f)) return;
    processSession(f, initial, cursors, emit);
  };
  sessionsWatcher.on("add", (f) => handleSession(f, true));
  sessionsWatcher.on("change", (f) => handleSession(f, false));
  sessionsWatcher.on("error", swallow);
  stoppers.push(() => {
    void sessionsWatcher.close();
  });

  // 2) config-audit.jsonl — security-relevant config writes
  const auditPath = join(root, "logs", "config-audit.jsonl");
  const auditWatcher = chokidar.watch(auditPath, {
    persistent: true,
    ignoreInitial: false,
  });
  auditWatcher.on("add", (f) => processAudit(f, true, cursors, emit));
  auditWatcher.on("change", (f) => processAudit(f, false, cursors, emit));
  auditWatcher.on("error", swallow);
  stoppers.push(() => {
    void auditWatcher.close();
  });

  return () => {
    for (const s of stoppers) s();
  };
}

function processSession(
  file: string,
  startFromEnd: boolean,
  cursors: Map<string, FileCursor>,
  emit: (e: AgentEvent) => void,
) {
  const subAgent = extractSubAgent(file);
  const sessionId = basename(file, ".jsonl");
  // Lazy-load the per-agent sessions.json so we know whether this
  // session was spawned by cron or by a heartbeat run.
  loadScheduledMarkers(file);
  const marker = scheduledBySessionId.get(sessionId);
  streamLines(file, startFromEnd, cursors, (line) => {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    const event = translateSession(obj, subAgent, sessionId);
    if (!event) return;
    if (marker) {
      event.details = {
        ...(event.details ?? {}),
        scheduled: {
          kind: marker.kind,
          jobId: marker.jobId,
          agentId: marker.agentId,
          runId: marker.runId,
        },
      };
    }
    emit(event);
  });
}

function processAudit(
  file: string,
  startFromEnd: boolean,
  cursors: Map<string, FileCursor>,
  emit: (e: AgentEvent) => void,
) {
  streamLines(file, startFromEnd, cursors, (line) => {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    const event = translateAudit(obj);
    if (event) emit(event);
  });
}

/** Same backfill window as Claude adapter; see its comment. */
const BACKFILL_BYTES = 4 * 1024 * 1024;

function streamLines(
  file: string,
  isInitialAdd: boolean,
  cursors: Map<string, FileCursor>,
  onLine: (line: string) => void,
): void {
  const size = safeSize(file);
  let cursor = cursors.get(file);
  if (!cursor) {
    const backfillStart = Math.max(0, size - BACKFILL_BYTES);
    cursor = { offset: isInitialAdd ? backfillStart : size };
    cursors.set(file, cursor);
  }
  if (size <= cursor.offset) return;

  const start = cursor.offset;
  const stream = createReadStream(file, {
    start,
    end: size - 1,
    encoding: "utf8",
  });
  let consumed = 0;
  let skippedFirst = false;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on("line", (line) => {
    consumed += Buffer.byteLength(line, "utf8") + 1;
    // If we started mid-file, drop the first (likely partial) line
    if (isInitialAdd && start > 0 && !skippedFirst) {
      skippedFirst = true;
      return;
    }
    if (line.trim()) onLine(line);
  });
  rl.on("close", () => {
    cursor!.offset = start + consumed;
  });
}

function swallow(err: unknown): void {
  if (typeof err !== "object" || err === null) return;
  const code = (err as { code?: string }).code;
  if (code === "EMFILE" || code === "ENOSPC" || code === "EACCES") return;
  // eslint-disable-next-line no-console
  console.error("[agentwatch/openclaw]", String(err));
}

function safeSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function extractSubAgent(file: string): string {
  // /Users/.../\.openclaw/agents/<sub-agent>/sessions/<id>.jsonl
  const parts = file.split(sep);
  const agentsIdx = parts.lastIndexOf("agents");
  if (agentsIdx >= 0 && parts[agentsIdx + 1]) return parts[agentsIdx + 1]!;
  return "unknown";
}

/** OpenClaw records usage on the assistant message directly:
 *   { input, output, cacheRead, cacheWrite, totalTokens, cost: {…} }
 *
 *  Fields map cleanly onto our schema except cacheWrite → cacheCreate. */
export function extractOpenClawUsage(
  msg: Record<string, unknown> | undefined,
): { input: number; cacheCreate: number; cacheRead: number; output: number } | null {
  const u = msg?.usage;
  if (!u || typeof u !== "object") return null;
  const o = u as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" ? v : 0);
  const input = n(o.input);
  const output = n(o.output);
  const cacheRead = n(o.cacheRead);
  const cacheCreate = n(o.cacheWrite);
  if (input + output + cacheRead + cacheCreate === 0) return null;
  return { input, cacheCreate, cacheRead, output };
}

export function extractOpenClawCost(
  msg: Record<string, unknown> | undefined,
): number | null {
  const u = msg?.usage;
  if (!u || typeof u !== "object") return null;
  const c = (u as Record<string, unknown>).cost;
  if (!c || typeof c !== "object") return null;
  const total = (c as Record<string, unknown>).total;
  return typeof total === "number" ? total : null;
}

export function translateSession(
  obj: unknown,
  subAgent: string,
  sessionId: string,
): AgentEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const ts = clampTs(
    (typeof o.timestamp === "string" && o.timestamp) ||
      new Date().toISOString(),
  );
  const t = o.type;

  const projectLabel = () => {
    const cwd = sessionCwd.get(sessionId);
    if (!cwd) return "";
    const b = cwd.split("/").filter(Boolean).pop();
    return b ? `[${b}] ` : "";
  };

  const base = (
    type: EventType,
    fields: Partial<AgentEvent> = {},
  ): AgentEvent => {
    const prefix = projectLabel();
    const rawSummary = fields.summary ?? "";
    return {
      id: nextId(),
      ts,
      agent: "openclaw",
      type,
      tool: `openclaw:${subAgent}`,
      sessionId,
      riskScore: riskOf(type, fields.path, fields.cmd),
      ...fields,
      summary: rawSummary ? prefix + rawSummary : prefix + type,
    };
  };

  if (t === "session") {
    const cwd = typeof o.cwd === "string" ? o.cwd : undefined;
    if (cwd) sessionCwd.set(sessionId, cwd);
    return base("session_start", {
      path: cwd,
      summary: `openclaw/${subAgent} session started${cwd ? ` in ${cwd}` : ""}`,
    });
  }

  if (t === "model_change") {
    const model = typeof o.modelId === "string" ? o.modelId : "";
    const provider = typeof o.provider === "string" ? o.provider : "";
    return base("tool_call", {
      summary: `model → ${provider}/${model}`,
      tool: `openclaw:${subAgent}:model`,
    });
  }

  if (t === "message") {
    const msg = o.message as Record<string, unknown> | undefined;
    const role = msg?.role;
    const content = msg?.content;
    const text = extractText(content);
    if (role === "user") {
      return base("prompt", {
        summary: truncate(text),
        details: { fullText: text },
      });
    }
    if (role === "assistant") {
      const usage = extractOpenClawUsage(msg);
      const model =
        typeof msg?.model === "string" ? msg.model : undefined;
      const precomputedCost = extractOpenClawCost(msg);
      const toolUse = extractToolUse(content);
      if (toolUse) {
        const type = inferToolType(toolUse.name);
        return base(type, {
          tool: `openclaw:${subAgent}:${toolUse.name}`,
          path: toolUse.path,
          cmd: toolUse.cmd,
          summary: truncate(toolUse.summary),
          details: {
            toolInput: toolUse.input,
            ...(usage ? { usage } : {}),
            ...(precomputedCost != null ? { cost: precomputedCost } : {}),
            ...(model ? { model } : {}),
          },
        });
      }
      if (!text) return null; // suppress empty assistant messages
      return base("response", {
        summary: truncate(text),
        details: {
          fullText: text,
          ...(usage ? { usage } : {}),
          ...(precomputedCost != null ? { cost: precomputedCost } : {}),
          ...(model ? { model } : {}),
        },
      });
    }
  }

  return null;
}

export function translateAudit(obj: unknown): AgentEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const ts = clampTs(
    (typeof o.ts === "string" && o.ts) || new Date().toISOString(),
  );
  const event = typeof o.event === "string" ? o.event : "config.event";
  const configPath = typeof o.configPath === "string" ? o.configPath : undefined;
  const cwd = typeof o.cwd === "string" ? o.cwd : undefined;
  const argv = Array.isArray(o.argv) ? (o.argv as string[]).join(" ") : "";
  const suspicious = Array.isArray(o.suspicious) && o.suspicious.length > 0;

  return {
    id: nextId(),
    ts,
    agent: "openclaw",
    type: "file_write",
    tool: `openclaw:audit:${event}`,
    path: configPath,
    cmd: argv,
    summary: `${event}${configPath ? ` ${basename(configPath)}` : ""}${cwd ? ` (cwd: ${cwd})` : ""}`,
    // audit writes are inherently sensitive; suspicious flag bumps to max
    riskScore: suspicious ? 10 : Math.max(5, riskOf("file_write", configPath)),
  };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (c: unknown): c is { type: string; text: string } =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "text",
    )
    .map((c) => c.text)
    .join(" ");
}

interface ToolUse {
  name: string;
  path?: string;
  cmd?: string;
  summary: string;
  input: Record<string, unknown>;
}

function extractToolUse(content: unknown): ToolUse | null {
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (
      typeof c === "object" &&
      c !== null &&
      (c as { type?: string }).type === "tool_use"
    ) {
      const r = c as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name : "unknown";
      const input = (r.input ?? {}) as Record<string, unknown>;
      const path =
        typeof input.file_path === "string"
          ? input.file_path
          : typeof input.path === "string"
            ? input.path
            : undefined;
      const cmd = typeof input.command === "string" ? input.command : undefined;
      const summary = cmd ?? path ?? name;
      return { name, path, cmd, summary, input };
    }
  }
  return null;
}

function inferToolType(name: string): EventType {
  if (/^Bash|^Shell|^Exec/i.test(name)) return "shell_exec";
  if (/^Read|^View|^Open/i.test(name)) return "file_read";
  if (/^(Write|Edit|MultiEdit|Create)/i.test(name)) return "file_write";
  return "tool_call";
}

function truncate(s: string, max = 140): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

