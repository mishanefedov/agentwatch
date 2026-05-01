import type { FastifyInstance } from "fastify";
import {
  aggregateProjectYield,
  correlateSessionYield,
  findProjectGitRoot,
  listCommits,
} from "../../git/correlate.js";
import type { EventStore } from "../../store/sqlite.js";
import { detectWorkspaceRoot } from "../../util/workspace.js";

/** `$/commit` and `$/line` views — pairs sessions and projects with the
 *  commits that landed during their time window. Returns empty payloads
 *  when no store is attached or the project isn't a git repo under
 *  WORKSPACE_ROOT. Read-only. */
export function registerYieldRoutes(
  app: FastifyInstance,
  store?: EventStore,
): void {
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/yield",
    async (req, reply) => {
      const id = decodeURIComponent(req.params.id);
      if (!store) return { sessionId: id, ok: false, reason: "no store" };
      const sessions = store.listSessions({ limit: 1, since: undefined });
      const session = store.listSessions({ limit: 5000 }).find(
        (s) => s.sessionId === id,
      );
      if (!session) {
        reply.code(404);
        return { sessionId: id, ok: false, reason: "session not found" };
      }
      void sessions;
      if (!session.project) {
        return {
          sessionId: id,
          ok: false,
          reason: "session has no project tag",
        };
      }
      const repo = findProjectGitRoot(detectWorkspaceRoot(), session.project);
      if (!repo) {
        return {
          sessionId: id,
          ok: false,
          reason: "project is not a git repo under WORKSPACE_ROOT",
        };
      }
      const commits = listCommits(repo, {
        since: session.firstTs,
        until: new Date(
          Date.parse(session.lastTs) + 60 * 60 * 1000,
        ).toISOString(),
      });
      return {
        sessionId: id,
        ok: true,
        project: session.project,
        repoPath: repo,
        yield: correlateSessionYield(session, commits),
      };
    },
  );

  app.get<{ Params: { name: string } }>(
    "/api/projects/:name/yield",
    async (req) => {
      const name = decodeURIComponent(req.params.name);
      if (!store) return { project: name, ok: false, reason: "no store" };
      const repo = findProjectGitRoot(detectWorkspaceRoot(), name);
      if (!repo) {
        return {
          project: name,
          ok: false,
          reason: "project is not a git repo under WORKSPACE_ROOT",
        };
      }
      const sessions = store.listSessions({ project: name, limit: 5000 });
      if (sessions.length === 0) {
        return { project: name, ok: true, repoPath: repo, yield: emptyYield(name) };
      }
      const earliest = sessions
        .map((s) => s.firstTs)
        .sort()[0] ?? new Date().toISOString();
      const latest = sessions.map((s) => s.lastTs).sort().pop() ?? new Date().toISOString();
      const commits = listCommits(repo, {
        since: earliest,
        until: new Date(Date.parse(latest) + 60 * 60 * 1000).toISOString(),
      });
      return {
        project: name,
        ok: true,
        repoPath: repo,
        yield: aggregateProjectYield(name, sessions, commits),
      };
    },
  );
}

function emptyYield(project: string): {
  project: string;
  weekly: never[];
  spendWithoutCommit: never[];
} {
  return { project, weekly: [], spendWithoutCommit: [] };
}
