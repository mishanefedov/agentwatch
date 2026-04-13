import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentName } from "../schema.js";

export interface DetectedAgent {
  name: AgentName;
  label: string;
  configPath?: string;
  present: boolean;
}

export function detectAgents(): DetectedAgent[] {
  const home = homedir();
  return [
    {
      name: "claude-code",
      label: "Claude Code",
      configPath: join(home, ".claude", "settings.json"),
      present: existsSync(join(home, ".claude", "projects")),
    },
    {
      name: "codex",
      label: "Codex",
      configPath: join(home, ".codex", "config.toml"),
      present: existsSync(join(home, ".codex")),
    },
    {
      name: "cursor",
      label: "Cursor",
      configPath: join(home, ".cursor", "mcp.json"),
      present: existsSync(join(home, ".cursor")),
    },
    {
      name: "gemini",
      label: "Gemini CLI",
      configPath: join(home, ".gemini", "settings.json"),
      present: existsSync(join(home, ".gemini")),
    },
    {
      name: "openclaw",
      label: "OpenClaw",
      configPath: join(home, ".openclaw"),
      present: existsSync(join(home, ".openclaw")),
    },
  ];
}
