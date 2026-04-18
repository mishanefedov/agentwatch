import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "../../schema.js";

/** A diff entry: a file_write / file_change event paired with the nearest
 *  preceding prompt in the same session. Implements AUR-114 (diff
 *  attribution) — answers "what user ask caused this write?" */
interface DiffEntry {
  event: AgentEvent;
  triggeringPrompt?: AgentEvent;
  oldString?: string;
  newString?: string;
  content?: string;
}

function isWriteEvent(e: AgentEvent): boolean {
  return e.type === "file_write" || e.type === "file_change";
}

export function registerDiffRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.get<{ Params: { id: string } }>("/api/sessions/:id/diffs", async (req, reply) => {
    const id = decodeURIComponent(req.params.id);
    const session = events
      .filter((e) => e.sessionId === id)
      .slice()
      .reverse(); // chronological
    if (session.length === 0) {
      reply.code(404);
      return { error: "session not found" };
    }

    const entries: DiffEntry[] = [];
    for (let i = 0; i < session.length; i++) {
      const e = session[i]!;
      if (!isWriteEvent(e)) continue;
      // Walk back to the nearest user prompt in this session.
      let triggering: AgentEvent | undefined;
      for (let j = i - 1; j >= 0; j--) {
        const prev = session[j]!;
        if (prev.type === "prompt") {
          triggering = prev;
          break;
        }
      }
      const input = e.details?.toolInput ?? {};
      const oldString = typeof input.old_string === "string" ? (input.old_string as string) : undefined;
      const newString = typeof input.new_string === "string" ? (input.new_string as string) : undefined;
      const content = typeof input.content === "string" ? (input.content as string) : undefined;
      entries.push({
        event: e,
        triggeringPrompt: triggering,
        oldString,
        newString,
        content,
      });
    }

    return {
      sessionId: id,
      diffs: entries,
      count: entries.length,
    };
  });
}
