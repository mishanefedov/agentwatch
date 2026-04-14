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
  // and filter by path regex. Two shapes matter:
  //   …/projects/<proj>/<session>.jsonl                  — main session
  //   …/projects/<proj>/<session>/subagents/<agent>.jsonl — subagent run
  const mainRe = /[\\/]projects[\\/][^\\/]+[\\/][^\\/]+\.jsonl$/;
  const subRe = /[\\/]projects[\\/][^\\/]+[\\/][^\\/]+[\\/]subagents[\\/][^\\/]+\.jsonl$/;
  const watcher = chokidar.watch(dir, {
    persistent: true,
    ignoreInitial: false,
    depth: 5,
  });

  const process = (file: string, isInitialAdd: boolean) => {
    const isSub = subRe.test(file);
    if (!isSub && !mainRe.test(file)) return;
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
    const subAgentId = isSub ? extractSubAgentId(file) : undefined;
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
        const event = translateClaudeLine(obj, sessionId, project, subAgentId);
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

function extractSubAgentId(file: string): string {
  // …/subagents/agent-<id>.jsonl → <id>
  const base = basename(file, ".jsonl");
  return base.replace(/^agent-/, "");
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
  subAgentId?: string,
): AgentEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const ts =
    (typeof o.timestamp === "string" && o.timestamp) ||
    new Date().toISOString();
  const tagParts: string[] = [];
  if (project) tagParts.push(project);
  if (subAgentId) tagParts.push(`sub:${subAgentId.slice(0, 8)}`);
  const prefix = tagParts.length > 0 ? `[${tagParts.join(" / ")}] ` : "";

  const role = o.role ?? (o.message as Record<string, unknown> | undefined)?.role;
  const type = o.type;
  const content = (o.message as Record<string, unknown> | undefined)?.content;

  // Suppress obvious noise
  if (type === "tool_result" || type === "summary") return null;
  if (type === "worktree-state" || type === "compact") return null;

  // Assistant tool use — the real interesting signal. Walk content[] for
  // tool_use blocks and surface the tool name + command / path.
  if (type === "assistant" || role === "assistant") {
    const toolUse = findToolUse(content);
    if (toolUse) {
      const evType = inferToolType(toolUse.name);
      const summary = buildToolSummary(toolUse);
      return {
        id: nextId(),
        ts,
        agent: "claude-code",
        type: evType,
        path: toolUse.path,
        cmd: toolUse.cmd,
        tool: toolUse.name,
        summary: prefix + summary,
        sessionId,
        riskScore: riskOf(evType, toolUse.path, toolUse.cmd),
        details: {
          toolInput: toolUse.input,
          toolUseId: toolUse.id,
          thinking: extractThinking(content),
        },
      };
    }
    const text = extractText(content);
    const thinking = extractThinking(content);
    if (!text && !thinking) return null; // suppress empty assistant messages
    return {
      id: nextId(),
      ts,
      agent: "claude-code",
      type: "response",
      summary: prefix + truncate(text || thinking || ""),
      sessionId,
      riskScore: riskOf("response"),
      details: {
        fullText: text || undefined,
        thinking: thinking || undefined,
      },
    };
  }

  if (type === "user" || role === "user") {
    const text = extractUserText(content);
    if (!text) return null; // suppress tool_result-only user turns
    return {
      id: nextId(),
      ts,
      agent: "claude-code",
      type: "prompt",
      summary: prefix + truncate(text),
      sessionId,
      riskScore: riskOf("prompt"),
      details: { fullText: text },
    };
  }

  return null;
}

interface ToolUse {
  name: string;
  path?: string;
  cmd?: string;
  input: Record<string, unknown>;
  id?: string;
}

function findToolUse(content: unknown): ToolUse | null {
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (rec.type !== "tool_use") continue;
    const name = typeof rec.name === "string" ? rec.name : "unknown";
    const id = typeof rec.id === "string" ? rec.id : undefined;
    const input = (rec.input ?? {}) as Record<string, unknown>;
    const path =
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.path === "string"
          ? input.path
          : undefined;
    const cmd = typeof input.command === "string" ? input.command : undefined;
    return { name, path, cmd, input, id };
  }
  return null;
}

function extractThinking(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (rec.type === "thinking" && typeof rec.thinking === "string") {
      parts.push(rec.thinking);
    }
  }
  return parts.join("\n").trim();
}

function buildToolSummary(t: ToolUse): string {
  // Prefer cmd for shell, path for file ops, a one-line arg summary otherwise.
  if (/^Bash/i.test(t.name) && t.cmd) return `Bash: ${truncate(t.cmd, 100)}`;
  if (/^(Write|Edit|MultiEdit|Read)/i.test(t.name) && t.path) {
    return `${t.name}: ${t.path}`;
  }
  if (/^(Grep|Glob)/i.test(t.name)) {
    const pat =
      typeof t.input.pattern === "string"
        ? t.input.pattern
        : typeof t.input.glob === "string"
          ? t.input.glob
          : "";
    return `${t.name}: ${truncate(pat, 100)}`;
  }
  if (/^Task/i.test(t.name)) {
    const desc =
      typeof t.input.description === "string" ? t.input.description : "";
    return `Task: ${truncate(desc, 100)}`;
  }
  if (/^WebFetch/i.test(t.name)) {
    const url = typeof t.input.url === "string" ? t.input.url : "";
    return `WebFetch: ${url}`;
  }
  // Fallback: tool name + first scalar input value
  const firstVal = Object.values(t.input).find(
    (v): v is string => typeof v === "string",
  );
  return firstVal ? `${t.name}: ${truncate(firstVal, 100)}` : t.name;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (rec.type === "thinking" && typeof rec.thinking === "string") {
      parts.push(rec.thinking);
    }
  }
  return parts.join(" ").trim();
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (typeof c !== "object" || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    }
    // tool_result blocks: skip — these are noise from the user's POV
  }
  return parts.join(" ").trim();
}

function inferToolType(name: string): EventType {
  if (/^Bash/i.test(name)) return "shell_exec";
  if (/^(Read|Grep|Glob)/i.test(name)) return "file_read";
  if (/^(Write|Edit|MultiEdit)/i.test(name)) return "file_write";
  return "tool_call";
}

function truncate(s: string, max = 140): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

