import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ClaudePermissions {
  source: string;
  allow: string[];
  deny: string[];
  defaultMode: string;
  additionalDirectories: string[];
  flags: PermissionFlag[];
}

export interface PermissionFlag {
  level: "warn" | "risk";
  message: string;
}

export function readClaudePermissions(
  workspace?: string,
): ClaudePermissions[] {
  const sources: string[] = [join(homedir(), ".claude", "settings.json")];
  if (workspace) {
    sources.push(join(workspace, ".claude", "settings.json"));
    sources.push(join(workspace, ".claude", "settings.local.json"));
  }
  const out: ClaudePermissions[] = [];
  for (const path of sources) {
    const parsed = readOne(path);
    if (parsed) out.push(parsed);
  }
  return out;
}

function readOne(path: string): ClaudePermissions | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const perms = (obj.permissions ?? {}) as Record<string, unknown>;
    const allow = toStringArray(perms.allow);
    const deny = toStringArray(perms.deny);
    const defaultMode =
      typeof perms.defaultMode === "string" ? perms.defaultMode : "default";
    const additionalDirectories = toStringArray(perms.additionalDirectories);
    return {
      source: path,
      allow,
      deny,
      defaultMode,
      additionalDirectories,
      flags: assessRisk({ allow, deny, defaultMode }),
    };
  } catch {
    return null;
  }
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function assessRisk({
  allow,
  deny,
  defaultMode,
}: {
  allow: string[];
  deny: string[];
  defaultMode: string;
}): PermissionFlag[] {
  const flags: PermissionFlag[] = [];

  if (allow.some((a) => /^Bash\(\*\)$/i.test(a))) {
    flags.push({
      level: "risk",
      message: "Bash(*) allows arbitrary shell — any command not explicitly denied will run",
    });
  }
  if (allow.some((a) => /^Write$/i.test(a) || /^Edit$/i.test(a))) {
    if (!deny.some((d) => /(^|[\s(])~\/\.ssh|\.aws|\.gnupg/.test(d))) {
      flags.push({
        level: "warn",
        message: "Write/Edit allowed with no deny rule for ~/.ssh, ~/.aws, ~/.gnupg",
      });
    }
  }
  if (deny.length === 0) {
    flags.push({
      level: "warn",
      message: "deny list is empty — no guardrails against destructive commands",
    });
  }
  if (defaultMode === "auto" || defaultMode === "bypassPermissions") {
    flags.push({
      level: "warn",
      message: `defaultMode=${defaultMode} — anything not in allow/deny runs without prompting`,
    });
  }
  return flags;
}
