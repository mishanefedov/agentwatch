import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentName } from "../schema.js";

/**
 * Per-agent memory-file resolution. Each agent has its own convention
 * for project-level system instructions; we resolve the right file for
 * a given session's (agent, cwd) pair and tokenize it so the token
 * attribution view can report it as a real overhead category.
 *
 * Files we look for, in priority order per agent:
 *   claude-code : <cwd>/CLAUDE.md  + ~/.claude/CLAUDE.md (concatenated)
 *   codex       : <cwd>/AGENTS.md  + ~/.codex/AGENTS.md
 *   gemini      : <cwd>/GEMINI.md  + ~/.gemini/GEMINI.md
 *   cursor      : <cwd>/.cursorrules (+ .cursor/rules/*.mdc)
 *   windsurf    : <cwd>/.windsurfrules
 *   aider       : <cwd>/CONVENTIONS.md
 *   openclaw    : <cwd>/OPENCLAW.md (convention; user-defined)
 *   (anything else) : no memory file
 */

export interface MemoryFileInfo {
  paths: string[];
  text: string;
}

export function memoryFilesFor(
  agent: AgentName,
  cwd: string,
  home: string = os.homedir(),
): MemoryFileInfo {
  const paths: string[] = [];
  switch (agent) {
    case "claude-code":
      paths.push(path.join(cwd, "CLAUDE.md"));
      paths.push(path.join(home, ".claude", "CLAUDE.md"));
      break;
    case "codex":
      paths.push(path.join(cwd, "AGENTS.md"));
      paths.push(path.join(home, ".codex", "AGENTS.md"));
      break;
    case "gemini":
      paths.push(path.join(cwd, "GEMINI.md"));
      paths.push(path.join(home, ".gemini", "GEMINI.md"));
      break;
    case "cursor":
      paths.push(path.join(cwd, ".cursorrules"));
      // .cursor/rules/*.mdc — read all if the dir exists
      try {
        const rulesDir = path.join(cwd, ".cursor", "rules");
        for (const name of fs.readdirSync(rulesDir)) {
          if (name.endsWith(".mdc") || name.endsWith(".md")) {
            paths.push(path.join(rulesDir, name));
          }
        }
      } catch {
        /* no cursor rules dir */
      }
      break;
    case "windsurf":
      paths.push(path.join(cwd, ".windsurfrules"));
      break;
    case "aider":
      paths.push(path.join(cwd, "CONVENTIONS.md"));
      paths.push(path.join(cwd, ".aider.conf.yml"));
      break;
    case "openclaw":
      paths.push(path.join(cwd, "OPENCLAW.md"));
      break;
    default:
      /* unknown / cline / continue — no convention yet */
      break;
  }
  const existing: string[] = [];
  const chunks: string[] = [];
  for (const p of paths) {
    try {
      const text = fs.readFileSync(p, "utf8");
      existing.push(p);
      chunks.push(text);
    } catch {
      /* missing — fine */
    }
  }
  return { paths: existing, text: chunks.join("\n\n---\n\n") };
}
