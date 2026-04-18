import type { FastifyInstance } from "fastify";
import type { AgentEvent, AgentName } from "../../schema.js";
import { spawn } from "node:child_process";

interface ReplayBody {
  /** User-edited prompt text (defaults to the original if absent). */
  prompt?: string;
  /** Optional override of the CLI binary. Handy when the agent binary
   *  isn't on PATH (e.g. hermes installed into ~/.local/bin). */
  binaryPath?: string;
  /** Max wall-clock seconds before we kill the child process. */
  timeoutSec?: number;
}

/** Agent-aware replay: spawns the appropriate CLI in single-turn exec
 *  mode with the (possibly edited) prompt and streams stdout+stderr
 *  back. Implements AUR-116 (replay-with-edited-prompt).
 *
 *  Design boundary: we don't attempt to restore the agent's full
 *  context/session — this is a fresh single-turn run with the edited
 *  prompt. That's both safer (can't clobber original session state)
 *  and matches the dominant use case ("what would the agent say if I
 *  phrased this differently?"). */
function argBuilderFor(
  agent: AgentName,
): ((prompt: string) => { cmd: string; args: string[] }) | null {
  switch (agent) {
    case "claude-code":
      return (p) => ({ cmd: "claude", args: ["-p", p] });
    case "codex":
      return (p) => ({ cmd: "codex", args: ["exec", p] });
    case "gemini":
      return (p) => ({ cmd: "gemini", args: ["-p", p] });
    case "hermes":
      return (p) => ({ cmd: "hermes", args: ["chat", "-q", p, "-Q", "--max-turns", "1"] });
    case "cursor":
    case "openclaw":
    case "windsurf":
    case "aider":
    case "cline":
    case "continue":
    case "goose":
    case "unknown":
      return null;
  }
}

export function registerReplayRoutes(app: FastifyInstance, events: AgentEvent[]): void {
  app.post<{ Params: { id: string }; Body: ReplayBody }>(
    "/api/sessions/:id/replay",
    async (req, reply) => {
      const id = decodeURIComponent(req.params.id);
      const sessionEvents = events.filter((e) => e.sessionId === id);
      if (sessionEvents.length === 0) {
        reply.code(404);
        return { error: "session not found" };
      }
      const agent = sessionEvents[0]!.agent;
      const builder = argBuilderFor(agent);
      if (!builder) {
        reply.code(400);
        return { error: `replay not supported for agent "${agent}" yet` };
      }

      // Original prompt = first 'prompt' event (events are oldest-first).
      const firstPrompt = sessionEvents.find((e) => e.type === "prompt");
      const originalPrompt = firstPrompt?.details?.fullText ?? firstPrompt?.summary ?? "";
      const prompt = (req.body?.prompt ?? originalPrompt).trim();
      if (!prompt) {
        reply.code(400);
        return { error: "no prompt (body.prompt and no prompt event in session)" };
      }

      const { cmd, args } = builder(prompt);
      const binary = req.body?.binaryPath?.trim() || cmd;
      const timeoutMs = Math.min(300_000, Math.max(5_000, (req.body?.timeoutSec ?? 60) * 1000));

      const started = Date.now();
      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const child = spawn(binary, args, {
          env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH ?? ""}` },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout?.on("data", (d) => (stdout += d.toString()));
        child.stderr?.on("data", (d) => (stderr += d.toString()));
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore
          }
          resolve({
            ok: false,
            agent,
            prompt,
            command: `${binary} ${args.map((a) => JSON.stringify(a)).join(" ")}`,
            durationMs: Date.now() - started,
            stdout: truncate(stdout, 40_000),
            stderr: truncate(stderr, 40_000),
            error: `timed out after ${timeoutMs} ms`,
          });
        }, timeoutMs);
        child.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            ok: false,
            agent,
            prompt,
            command: `${binary} ${args.map((a) => JSON.stringify(a)).join(" ")}`,
            durationMs: Date.now() - started,
            stdout: truncate(stdout, 40_000),
            stderr: truncate(stderr, 40_000),
            error: String(err),
          });
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            ok: code === 0,
            exitCode: code,
            agent,
            prompt,
            command: `${binary} ${args.map((a) => JSON.stringify(a)).join(" ")}`,
            durationMs: Date.now() - started,
            stdout: truncate(stdout, 40_000),
            stderr: truncate(stderr, 40_000),
          });
        });
      });
    },
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… (${s.length - max} more chars truncated)`;
}
