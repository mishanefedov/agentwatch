import chokidar from "chokidar";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, sep } from "node:path";
import type { AgentEvent, EventType } from "../schema.js";
import { riskOf } from "../schema.js";
import { claudeProjectsDir } from "../util/workspace.js";
import { nextId } from "../util/ids.js";

type Emit = (e: AgentEvent) => void;

interface FileCursor {
  offset: number;
}

const BACKFILL_BYTES = 64 * 1024;

export function startClaudeAdapter(emit: Emit): () => void {
  const dir = claudeProjectsDir();
  if (!existsSync(dir)) {
    return () => {};
  }

  const cursors = new Map<string, FileCursor>();
  // chokidar v4 dropped glob support; watch the projects dir recursively
  // and filter by path regex.
  const sessionRe = /[\\/]projects[\\/][^\\/]+[\\/][^\\/]+\.jsonl$/;
  const watcher = chokidar.watch(dir, {
    persistent: true,
    ignoreInitial: false,
    depth: 3,
  });

  const process = (file: string, isInitialAdd: boolean) => {
    if (!sessionRe.test(file)) return;
    const size = safeSize(file);
    let cursor = cursors.get(file);
    if (!cursor) {
      const start = isInitialAdd ? Math.max(0, size - BACKFILL_BYTES) : size;
      cursor = { offset: start };
      cursors.set(file, cursor);
    }
    if (size <= cursor.offset) return;

    const start = cursor.offset;
    const stream = createReadStream(file, {
      start,
      end: size - 1,
      encoding: "utf8",
    });

    const sessionId = basename(file, ".jsonl");
    const project = extractProject(file);
    let consumed = 0;
    let skippedFirst = false;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      consumed += Buffer.byteLength(line, "utf8") + 1;
      if (isInitialAdd && start > 0 && !skippedFirst) {
        skippedFirst = true;
        return;
      }
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        const event = translateClaudeLine(obj, sessionId, project);
        if (event) emit(event);
      } catch {
        // ignore malformed lines
      }
    });

    rl.on("close", () => {
      cursor!.offset = start + consumed;
    });
  };

  watcher.on("add", (f) => process(f, true));
  watcher.on("change", (f) => process(f, false));
  watcher.on("error", (err) => {
    if (typeof err === "object" && err !== null) {
      const code = (err as { code?: string }).code;
      if (code === "EMFILE" || code === "ENOSPC" || code === "EACCES") return;
    }
    // eslint-disable-next-line no-console
    console.error("[agentwatch/claude]", String(err));
  });

  return () => {
    void watcher.close();
  };
}

/** Claude stores session files under ~/.claude/projects/<escaped-path>/<id>.jsonl
 *  where the escaped path replaces `/` with `-`. We return the last segment
 *  (e.g. `-Users-foo-IdeaProjects-auraqu` → `auraqu`). */
function extractProject(file: string): string {
  const parts = file.split(sep);
  const projIdx = parts.lastIndexOf("projects");
  if (projIdx >= 0 && parts[projIdx + 1]) {
    const dir = parts[projIdx + 1]!;
    const segs = dir.split("-").filter(Boolean);
    return segs[segs.length - 1] ?? dir;
  }
  return "";
}

function safeSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

export function translateClaudeLine(
  obj: unknown,
  sessionId: string,
  project: string = "",
): AgentEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const ts =
    (typeof o.timestamp === "string" && o.timestamp) ||
    new Date().toISOString();

  // Claude Code jsonl entries vary. Common shapes: user/assistant messages,
  // tool_use, tool_result. We extract the signal that matters.
  const type = detectType(o);
  if (!type) return null;

  const { path, cmd, tool, summary } = extractFields(o);
  const prefix = project ? `[${project}] ` : "";

  return {
    id: nextId(),
    ts,
    agent: "claude-code",
    type,
    path,
    cmd,
    tool,
    summary: summary ? prefix + summary : prefix + type,
    sessionId,
    riskScore: riskOf(type, path, cmd),
  };
}

function detectType(o: Record<string, unknown>): EventType | null {
  const role = o.role ?? (o.message as Record<string, unknown> | undefined)?.role;
  const type = o.type;

  if (type === "user" || role === "user") return "prompt";
  if (type === "assistant" || role === "assistant") {
    if (hasToolUse(o)) return "tool_call";
    return "response";
  }
  if (type === "tool_use") return inferToolType(o);
  if (type === "tool_result") return null; // suppress noise; tool_use covered it
  if (type === "summary") return null;
  return null;
}

function hasToolUse(o: Record<string, unknown>): boolean {
  const msg = o.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (Array.isArray(content)) {
    return content.some(
      (c: unknown) =>
        typeof c === "object" && c !== null && (c as { type?: string }).type === "tool_use",
    );
  }
  return false;
}

function inferToolType(o: Record<string, unknown>): EventType {
  const name = typeof o.name === "string" ? o.name : "";
  if (/^Bash/i.test(name)) return "shell_exec";
  if (/^Read/i.test(name)) return "file_read";
  if (/^(Write|Edit|MultiEdit)/i.test(name)) return "file_write";
  return "tool_call";
}

function extractFields(o: Record<string, unknown>): {
  path?: string;
  cmd?: string;
  tool?: string;
  summary?: string;
} {
  const name = typeof o.name === "string" ? o.name : undefined;
  const input = (o.input ?? {}) as Record<string, unknown>;
  const path =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : undefined;
  const cmd = typeof input.command === "string" ? input.command : undefined;

  let summary: string | undefined;
  const msg = o.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (typeof content === "string") {
    summary = truncate(content);
  } else if (Array.isArray(content)) {
    const text = content
      .filter((c: unknown): c is { type: string; text: string } =>
        typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
      )
      .map((c) => c.text)
      .join(" ");
    if (text) summary = truncate(text);
  }
  if (!summary && cmd) summary = truncate(cmd);
  if (!summary && path) summary = path;

  return { path, cmd, tool: name, summary };
}

function truncate(s: string, max = 120): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}
