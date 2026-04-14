import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OpenClawAgent {
  id: string;
  default?: boolean;
  workspace?: string;
  model?: string;
  name?: string;
  emoji?: string;
}

export interface OpenClawConfig {
  source: string;
  defaultWorkspace?: string;
  agents: OpenClawAgent[];
}

export function readOpenClawConfig(): OpenClawConfig | null {
  const path = join(homedir(), ".openclaw", "openclaw.json");
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const agentsObj = (obj.agents ?? {}) as Record<string, unknown>;
    const defaults = (agentsObj.defaults ?? {}) as Record<string, unknown>;
    const list = Array.isArray(agentsObj.list) ? agentsObj.list : [];
    return {
      source: path,
      defaultWorkspace:
        typeof defaults.workspace === "string" ? defaults.workspace : undefined,
      agents: list
        .filter((a: unknown): a is Record<string, unknown> =>
          typeof a === "object" && a !== null,
        )
        .map((a) => {
          const identity = (a.identity ?? {}) as Record<string, unknown>;
          return {
            id: typeof a.id === "string" ? a.id : "unknown",
            default: a.default === true,
            workspace:
              typeof a.workspace === "string" ? a.workspace : undefined,
            model: typeof a.model === "string" ? a.model : undefined,
            name: typeof identity.name === "string" ? identity.name : undefined,
            emoji:
              typeof identity.emoji === "string" ? identity.emoji : undefined,
          };
        }),
    };
  } catch {
    return null;
  }
}
