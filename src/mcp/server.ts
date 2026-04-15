import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { claudeProjectsDir } from "../util/workspace.js";
import { codexSessionsDir, translateCodexLine } from "../adapters/codex.js";
import { translateClaudeLine } from "../adapters/claude-code.js";
import type { AgentEvent } from "../schema.js";

/**
 * agentwatch MCP server. Exposes the user's local agent history so
 * running agents (Claude Code, Cursor, Codex) can look up what they —
 * or other agents — did before. Turns agentwatch from "viewer" into
 * "cross-session memory substrate".
 *
 * Transport: stdio. Run via `agentwatch mcp`.
 *
 * Tools:
 *   - list_recent_sessions   → [{agent, sessionId, project, lastActivity, events}]
 *   - get_session_events     → raw jsonl lines for a session
 *   - search_sessions        → grep across all session files
 *   - get_tool_usage_stats   → per-tool invocation counts + durations + errors
 *   - get_session_cost       → per-session cost, token breakdown, turn count
 */

interface SessionRef {
  agent: "claude-code" | "codex" | "gemini";
  sessionId: string;
  project: string;
  path: string;
  lastActivity: number;
  sizeBytes: number;
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "agentwatch",
    version: "0.0.2",
  });

  server.registerTool(
    "list_recent_sessions",
    {
      title: "List recent agent sessions",
      description:
        "List the most recent local agent sessions across Claude Code and Codex, newest first. Use to find a session to inspect.",
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
        "Return the raw JSONL lines for a given session ID. Use after list_recent_sessions to drill into a session.",
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
      const raw = readFileSync(match.path, "utf8");
      const trimmed =
        raw.length > cap ? raw.slice(raw.length - cap) : raw;
      return {
        content: [{ type: "text", text: trimmed }],
      };
    },
  );

  server.registerTool(
    "search_sessions",
    {
      title: "Search across all sessions",
      description:
        "Substring search across all local agent session files. Returns matching sessions with the first few matching lines.",
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
        try {
          const raw = readFileSync(s.path, "utf8");
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
        } catch {
          /* skip unreadable */
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

/** Read a session file, translate every line via the relevant adapter,
 *  and return AgentEvents. Unreadable / malformed lines are silently
 *  skipped. */
function parseSession(s: SessionRef): AgentEvent[] {
  let raw: string;
  try {
    raw = readFileSync(s.path, "utf8");
  } catch {
    return [];
  }
  if (s.agent === "gemini") {
    // Gemini sessions are single-JSON not JSONL, and we don't yet
    // translate them to AgentEvents for stats purposes. Return empty
    // so get_tool_usage_stats / get_session_cost produce honest zeroes
    // rather than fake data. Raw content still reachable via
    // get_session_events.
    return [];
  }
  const out: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const e =
        s.agent === "claude-code"
          ? translateClaudeLine(obj, s.sessionId, s.project)
          : translateCodexLine(obj, s.sessionId, s.project);
      if (e) out.push(e);
    } catch {
      /* malformed */
    }
  }
  return out;
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
  out.sort((a, b) => b.lastActivity - a.lastActivity);
  return out;
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
