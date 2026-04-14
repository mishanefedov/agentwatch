import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { AgentName } from "../schema.js";

export interface DetectedAgent {
  name: AgentName;
  label: string;
  configPath?: string;
  present: boolean;
  /** True when we detect the agent but don't yet emit events for it.
   *  Surface in the panel so users know it's not a bug. */
  instrumented?: boolean;
}

export function detectAgents(): DetectedAgent[] {
  const home = homedir();
  const os = platform();

  // Cline (VS Code extension "saoudrizwan.claude-dev") storage location
  // varies by OS.
  const clineDir =
    os === "darwin"
      ? join(
          home,
          "Library",
          "Application Support",
          "Code",
          "User",
          "globalStorage",
          "saoudrizwan.claude-dev",
        )
      : join(home, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev");

  return [
    {
      name: "claude-code",
      label: "Claude Code",
      configPath: join(home, ".claude", "settings.json"),
      present: existsSync(join(home, ".claude", "projects")),
      instrumented: true,
    },
    {
      name: "openclaw",
      label: "OpenClaw",
      configPath: join(home, ".openclaw"),
      present: existsSync(join(home, ".openclaw")),
      instrumented: true,
    },
    {
      name: "cursor",
      label: "Cursor",
      configPath: join(home, ".cursor", "mcp.json"),
      present: existsSync(join(home, ".cursor")),
      instrumented: true, // config-level only in v0; SQLite DB TBD
    },
    {
      name: "gemini",
      label: "Gemini CLI",
      configPath: join(home, ".gemini", "settings.json"),
      present: existsSync(join(home, ".gemini")),
      instrumented: true,
    },
    // Detected but not yet instrumented — surfaced so users don't think
    // agentwatch is broken when these show up in their workflow.
    {
      name: "codex",
      label: "Codex",
      configPath: join(home, ".codex", "sessions"),
      present: existsSync(join(home, ".codex")),
      instrumented: false,
    },
    {
      name: "aider",
      label: "Aider",
      configPath: "./.aider.chat.history.md (per-repo)",
      present:
        existsSync(join(home, ".aider.chat.history.md")) ||
        existsSync(join(home, ".aider.input.history")),
      instrumented: false,
    },
    {
      name: "cline",
      label: "Cline (VS Code)",
      configPath: clineDir,
      present: existsSync(clineDir),
      instrumented: false,
    },
    {
      name: "continue",
      label: "Continue.dev",
      configPath: join(home, ".continue"),
      present: existsSync(join(home, ".continue")),
      instrumented: false,
    },
    {
      name: "windsurf",
      label: "Windsurf",
      configPath: join(home, ".codeium"),
      present: existsSync(join(home, ".codeium")),
      instrumented: false,
    },
    {
      name: "goose",
      label: "Goose (Block)",
      configPath: join(home, ".config", "goose"),
      present: existsSync(join(home, ".config", "goose")),
      instrumented: false,
    },
  ];
}
