import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { claudeProjectsDir } from "../util/workspace.js";
import { codexSessionsDir, translateCodexLine } from "../adapters/codex.js";
import { translateClaudeLine } from "../adapters/claude-code.js";
import { translateSession as translateOpenClawLine } from "../adapters/openclaw.js";
import {
  translateHermesMessage,
  translateHermesSessionEnd,
  translateHermesSessionStart,
  type HermesMessage,
  type HermesSession,
} from "../adapters/hermes.js";
import type { AgentEvent } from "../schema.js";

/**
 * agentwatch MCP server. Exposes the user's local agent history so
 * running agents (Claude Code, Cursor, Codex, OpenClaw, Hermes) can
 * look up what they — or other agents — did before. Turns agentwatch
 * from "viewer" into "cross-session memory substrate".
 *
 * Transport: stdio. Run via `agentwatch mcp`.
 *
 * Tools:
 *   - list_recent_sessions   → [{agent, sessionId, project, lastActivity, sizeBytes}]
 *   - get_session_events     → raw jsonl lines for a session
 *   - search_sessions        → grep across all session files
 *   - get_tool_usage_stats   → per-tool invocation counts + durations + errors
 *   - get_session_cost       → per-session cost, token breakdown, turn count
 */

type McpAgent = "claude-code" | "codex" | "gemini" | "openclaw" | "hermes";

interface SessionRef {
  agent: McpAgent;
  sessionId: string;
  project: string;
  /** File path for JSONL agents; DB path for hermes. */
  path: string;
  lastActivity: number;
  sizeBytes: number;
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "agentwatch",
    version: "0.0.4",
  });

  server.registerTool(
    "list_recent_sessions",
    {
      title: "List recent agent sessions",
      description:
        "List the most recent local agent sessions across Claude Code, Codex, Gemini, OpenClaw, and Hermes, newest first. Use to find a session to inspect.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ limit }) => {
      const sessions = listAllSessions().slice(0, limit ?? 20);
      const rows = sessions.map((s) => ({
        agent: s.agent,
        sessionId: s.sessionId,
        project: s.project,
        lastActivity: new Date(s.lastActivity).toISOString(),
        sizeBytes: s.sizeBytes,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_session_events",
    {
      title: "Get raw events for a session",
      description:
        "Return the raw events for a given session ID. JSONL for file-based agents (Claude/Codex/Gemini/OpenClaw); Hermes messages are serialized as one JSON object per line. Use after list_recent_sessions to drill into a session.",
      inputSchema: {
        sessionId: z.string(),
        maxBytes: z.number().int().min(1024).max(10_000_000).optional(),
      },
    },
    async ({ sessionId, maxBytes }) => {
      const cap = maxBytes ?? 500_000;
      const match = listAllSessions().find((s) => s.sessionId === sessionId);
      if (!match) {
        return {
          isError: true,
          content: [
            { type: "text", text: `session ${sessionId} not found` },
          ],
        };
      }
      const raw =
        match.agent === "hermes"
          ? dumpHermesSessionJsonl(match)
          : safeReadFile(match.path);
      const trimmed = raw.length > cap ? raw.slice(raw.length - cap) : raw;
      return { content: [{ type: "text", text: trimmed }] };
    },
  );

  server.registerTool(
    "search_sessions",
    {
      title: "Search across all sessions",
      description:
        "Substring search across all local agent session files. Returns matching sessions with the first few matching lines. Covers Claude, Codex, Gemini, OpenClaw, and Hermes.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) => {
      const needle = query.toLowerCase();
      const out: { session: string; agent: string; line: string }[] = [];
      const cap = limit ?? 20;
      for (const s of listAllSessions()) {
        if (out.length >= cap) break;
        const raw =
          s.agent === "hermes" ? dumpHermesSessionJsonl(s) : safeReadFile(s.path);
        if (!raw) continue;
        for (const line of raw.split("\n")) {
          if (line.toLowerCase().includes(needle)) {
            out.push({
              session: s.sessionId,
              agent: s.agent,
              line: line.slice(0, 500),
            });
            if (out.length >= cap) break;
          }
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_tool_usage_stats",
    {
      title: "Tool usage statistics",
      description:
        "Aggregate tool invocation counts, total duration, and error counts. If sessionId is given, stats are scoped to that session; otherwise scoped to the N most recently active sessions across all agents (default 50).",
      inputSchema: {
        sessionId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async ({ sessionId, limit }) => {
      const sessions = sessionId
        ? listAllSessions().filter((s) => s.sessionId === sessionId)
        : listAllSessions().slice(0, limit ?? 50);
      if (sessions.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: sessionId
                ? `session ${sessionId} not found`
                : "no sessions found",
            },
          ],
        };
      }
      type Stat = {
        tool: string;
        count: number;
        totalDurationMs: number;
        errorCount: number;
      };
      const stats = new Map<string, Stat>();
      let turns = 0;
      let scannedSessions = 0;
      for (const s of sessions) {
        const events = parseSession(s);
        scannedSessions += 1;
        for (const e of events) {
          if (e.type === "prompt" || e.type === "response") turns += 1;
          const tool = e.tool;
          if (!tool) continue;
          let row = stats.get(tool);
          if (!row) {
            row = { tool, count: 0, totalDurationMs: 0, errorCount: 0 };
            stats.set(tool, row);
          }
          row.count += 1;
          if (e.details?.durationMs) row.totalDurationMs += e.details.durationMs;
          if (e.details?.toolError) row.errorCount += 1;
        }
      }
      const sorted = Array.from(stats.values()).sort((a, b) => b.count - a.count);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { scannedSessions, turns, tools: sorted },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_session_cost",
    {
      title: "Session cost + token breakdown",
      description:
        "Return total cost (USD), token counts broken down by input / cache read / cache create / output, and turn count for a given session.",
      inputSchema: {
        sessionId: z.string(),
      },
    },
    async ({ sessionId }) => {
      const match = listAllSessions().find((s) => s.sessionId === sessionId);
      if (!match) {
        return {
          isError: true,
          content: [
            { type: "text", text: `session ${sessionId} not found` },
          ],
        };
      }
      const events = parseSession(match);
      let totalCost = 0;
      let input = 0;
      let cacheRead = 0;
      let cacheCreate = 0;
      let output = 0;
      let turns = 0;
      const byModel = new Map<string, number>();
      for (const e of events) {
        const d = e.details;
        if (!d) continue;
        if (d.cost) {
          totalCost += d.cost;
          const model = d.model ?? "unknown";
          byModel.set(model, (byModel.get(model) ?? 0) + d.cost);
        }
        if (d.usage) {
          input += d.usage.input;
          cacheRead += d.usage.cacheRead;
          cacheCreate += d.usage.cacheCreate;
          output += d.usage.output;
          turns += 1;
        }
      }
      const result = {
        agent: match.agent,
        sessionId,
        project: match.project,
        totalCostUsd: Number(totalCost.toFixed(6)),
        turns,
        tokens: { input, cacheRead, cacheCreate, output },
        byModel: Object.fromEntries(
          Array.from(byModel.entries()).map(([m, c]) => [
            m,
            Number(c.toFixed(6)),
          ]),
        ),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function safeReadFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Serialize a hermes session — the session row plus every message —
 *  as one JSON object per line so `get_session_events` and
 *  `search_sessions` can treat it like any other JSONL source. */
function dumpHermesSessionJsonl(ref: SessionRef): string {
  const db = openHermesDb(ref.path);
  if (!db) return "";
  try {
    const session = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(ref.sessionId) as Record<string, unknown> | undefined;
    const messages = db
      .prepare(
        "SELECT id, session_id, role, content, tool_call_id, tool_calls, tool_name, " +
          "timestamp, token_count, finish_reason, reasoning " +
          "FROM messages WHERE session_id = ? ORDER BY id",
      )
      .all(ref.sessionId) as Record<string, unknown>[];
    const lines: string[] = [];
    if (session) lines.push(JSON.stringify({ kind: "session", ...session }));
    for (const m of messages) lines.push(JSON.stringify({ kind: "message", ...m }));
    return lines.join("\n");
  } catch {
    return "";
  } finally {
    try {
      db.close();
    } catch {
      // best-effort
    }
  }
}

function openHermesDb(path: string) {
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 2000");
    return db;
  } catch {
    return null;
  }
}

/** Read a session, translate every line via the relevant adapter,
 *  and return AgentEvents. Unreadable / malformed lines are silently
 *  skipped. */
function parseSession(s: SessionRef): AgentEvent[] {
  if (s.agent === "hermes") return parseHermesSession(s);
  if (s.agent === "gemini") {
    // Gemini sessions are single-JSON not JSONL, and we don't yet
    // translate them to AgentEvents for stats purposes. Return empty
    // so get_tool_usage_stats / get_session_cost produce honest zeroes
    // rather than fake data. Raw content still reachable via
    // get_session_events.
    return [];
  }
  const raw = safeReadFile(s.path);
  if (!raw) return [];
  const out: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const record = obj as Record<string, unknown>;
    let e: AgentEvent | null = null;
    if (s.agent === "claude-code")
      e = translateClaudeLine(record, s.sessionId, s.project);
    else if (s.agent === "codex")
      e = translateCodexLine(record, s.sessionId, s.project);
    else if (s.agent === "openclaw")
      e = translateOpenClawLine(record, s.project || "unknown", s.sessionId);
    if (e) out.push(e);
  }
  return out;
}

function parseHermesSession(s: SessionRef): AgentEvent[] {
  const db = openHermesDb(s.path);
  if (!db) return [];
  try {
    const session = db
      .prepare(
        "SELECT id, source, user_id, model, parent_session_id, started_at, ended_at, " +
          "end_reason, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, " +
          "actual_cost_usd, estimated_cost_usd FROM sessions WHERE id = ?",
      )
      .get(s.sessionId) as HermesSession | undefined;
    const messages = db
      .prepare(
        "SELECT id, session_id, role, content, tool_call_id, tool_calls, tool_name, " +
          "timestamp, token_count, finish_reason, reasoning " +
          "FROM messages WHERE session_id = ? ORDER BY id",
      )
      .all(s.sessionId) as HermesMessage[];
    const out: AgentEvent[] = [];
    if (session) {
      out.push(translateHermesSessionStart(session, s.path));
      if (session.ended_at !== null) {
        out.push(translateHermesSessionEnd(session, s.path));
      }
    }
    for (const m of messages) {
      const e = translateHermesMessage(m, s.path);
      if (e) out.push(e);
    }
    return out;
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // best-effort
    }
  }
}

function listAllSessions(): SessionRef[] {
  const out: SessionRef[] = [];
  try {
    const cdir = claudeProjectsDir();
    for (const proj of readdirSync(cdir)) {
      const projPath = join(cdir, proj);
      try {
        for (const f of readdirSync(projPath)) {
          if (!f.endsWith(".jsonl")) continue;
          const full = join(projPath, f);
          const s = statSync(full);
          out.push({
            agent: "claude-code",
            sessionId: f.replace(/\.jsonl$/, ""),
            project: projectFromClaudeDir(proj),
            path: full,
            lastActivity: s.mtimeMs,
            sizeBytes: s.size,
          });
        }
      } catch {
        /* unreadable project */
      }
    }
  } catch {
    /* no claude */
  }
  try {
    const cdir = codexSessionsDir();
    walkCodex(cdir, out);
  } catch {
    /* no codex */
  }
  try {
    const gdir = join(process.env.HOME ?? "", ".gemini", "tmp");
    walkGemini(gdir, out);
  } catch {
    /* no gemini */
  }
  try {
    walkOpenClaw(resolveOpenClawRoot(), out);
  } catch {
    /* no openclaw */
  }
  try {
    walkHermes(resolveHermesDbPath(), out);
  } catch {
    /* no hermes */
  }
  out.sort((a, b) => b.lastActivity - a.lastActivity);
  return out;
}

function resolveOpenClawRoot(): string {
  return join(homedir(), ".openclaw");
}

function resolveHermesDbPath(): string {
  const explicit = process.env.HERMES_DB_PATH?.trim();
  if (explicit && explicit.length > 0) return explicit;
  const hermesHome = process.env.HERMES_HOME?.trim();
  const base =
    hermesHome && hermesHome.length > 0
      ? hermesHome
      : join(homedir(), ".hermes");
  return join(base, "state.db");
}

function walkOpenClaw(root: string, out: SessionRef[]): void {
  if (!existsSync(root)) return;
  const agentsDir = join(root, "agents");
  let agents: string[];
  try {
    agents = readdirSync(agentsDir);
  } catch {
    return;
  }
  for (const agent of agents) {
    const sessionsDir = join(agentsDir, agent, "sessions");
    let files: string[];
    try {
      files = readdirSync(sessionsDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const full = join(sessionsDir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      out.push({
        agent: "openclaw",
        sessionId: name.replace(/\.jsonl$/, ""),
        project: agent,
        path: full,
        lastActivity: st.mtimeMs,
        sizeBytes: st.size,
      });
    }
  }
}

function walkHermes(dbPath: string, out: SessionRef[]): void {
  if (!existsSync(dbPath)) return;
  const db = openHermesDb(dbPath);
  if (!db) return;
  try {
    const st = statSync(dbPath);
    type Row = {
      id: string;
      source: string | null;
      message_count: number | null;
      started_at: number;
      ended_at: number | null;
    };
    const rows = db
      .prepare(
        "SELECT id, source, message_count, started_at, ended_at FROM sessions",
      )
      .all() as Row[];
    for (const r of rows) {
      const lastSec = r.ended_at ?? r.started_at;
      out.push({
        agent: "hermes",
        sessionId: r.id,
        project: r.source ?? "hermes",
        path: dbPath,
        lastActivity: Math.floor(lastSec * 1000) || st.mtimeMs,
        sizeBytes: r.message_count ?? 0,
      });
    }
  } catch {
    /* best-effort */
  } finally {
    try {
      db.close();
    } catch {
      // best-effort
    }
  }
}

function walkGemini(dir: string, out: SessionRef[]): void {
  let projects: string[];
  try {
    projects = readdirSync(dir);
  } catch {
    return;
  }
  for (const project of projects) {
    const chatsDir = join(dir, project, "chats");
    let files: string[];
    try {
      files = readdirSync(chatsDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith(".json")) continue;
      const full = join(chatsDir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      const base = name.replace(/\.json$/, "");
      const m = base.match(/^session-[0-9T:\-]+-(.+)$/);
      out.push({
        agent: "gemini",
        sessionId: m?.[1] ?? base,
        project,
        path: full,
        lastActivity: st.mtimeMs,
        sizeBytes: st.size,
      });
    }
  }
}

function walkCodex(dir: string, out: SessionRef[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkCodex(full, out);
    } else if (st.isFile() && /^rollout-.*\.jsonl$/.test(name)) {
      const m = name.match(/rollout-[0-9T:\-.]+-(.+)\.jsonl$/);
      out.push({
        agent: "codex",
        sessionId: m?.[1] ?? name,
        project: "",
        path: full,
        lastActivity: st.mtimeMs,
        sizeBytes: st.size,
      });
    }
  }
}

function projectFromClaudeDir(dir: string): string {
  const segs = dir.split("-").filter(Boolean);
  return segs[segs.length - 1] ?? dir;
}
