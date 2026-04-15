import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { claudeProjectsDir } from "../util/workspace.js";
import { codexSessionsDir } from "../adapters/codex.js";

/**
 * agentwatch MCP server. Exposes the user's local agent history so
 * running agents (Claude Code, Cursor, Codex) can look up what they —
 * or other agents — did before. Turns agentwatch from "viewer" into
 * "cross-session memory substrate".
 *
 * Transport: stdio. Run via `agentwatch mcp`.
 *
 * Tools:
 *   - list_recent_sessions  → [{agent, sessionId, project, lastActivity, events}]
 *   - get_session_events    → raw jsonl lines for a session
 *   - search_sessions       → grep across all session files
 */

interface SessionRef {
  agent: "claude-code" | "codex";
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
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
  out.sort((a, b) => b.lastActivity - a.lastActivity);
  return out;
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
