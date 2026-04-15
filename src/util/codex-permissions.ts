import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Codex permission surface. Two sources:
 *   ~/.codex/config.toml — per-project trust_level + global overrides
 *   latest rollout session → turn_context.sandbox_policy + approval_policy
 *
 * The config is a thin TOML file (we do a best-effort regex-based parse
 * rather than pulling in a full TOML dependency — the shape is small and
 * stable). Sandbox policy info comes from the most recent session so we
 * can show what the agent is actually running with, not just what's in
 * the config file.
 */

export interface CodexProjectTrust {
  cwd: string;
  trustLevel: string;
}

export interface CodexPermissions {
  configPath: string;
  projects: CodexProjectTrust[];
  sandboxPolicy?: string;
  writableRoots?: string[];
  networkAccess?: boolean;
  approvalPolicy?: string;
  model?: string;
  present: boolean;
}

export function readCodexPermissions(home: string = os.homedir()): CodexPermissions {
  const configPath = path.join(home, ".codex", "config.toml");
  const base: CodexPermissions = {
    configPath,
    projects: [],
    present: false,
  };
  if (!fs.existsSync(configPath)) return base;
  base.present = true;
  try {
    const text = fs.readFileSync(configPath, "utf8");
    base.projects = parseProjectsToml(text);
  } catch {
    /* unreadable config */
  }
  // Augment with the latest session's sandbox_policy.
  const latest = findLatestSession(home);
  if (latest) {
    try {
      const raw = fs.readFileSync(latest, "utf8");
      const lines = raw.split("\n");
      for (const line of lines) {
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "turn_context") {
            const p = obj.payload ?? {};
            if (p.sandbox_policy) {
              const sp = p.sandbox_policy;
              base.sandboxPolicy = typeof sp === "object" && sp ? String(sp.type ?? "?") : String(sp);
              base.writableRoots =
                Array.isArray(sp?.writable_roots) ? sp.writable_roots : [];
              base.networkAccess = Boolean(sp?.network_access);
            }
            if (typeof p.approval_policy === "string") {
              base.approvalPolicy = p.approval_policy;
            }
            if (typeof p.model === "string") base.model = p.model;
          }
        } catch {
          /* malformed line */
        }
      }
    } catch {
      /* unreadable session */
    }
  }
  return base;
}

function parseProjectsToml(text: string): CodexProjectTrust[] {
  const out: CodexProjectTrust[] = [];
  const sectionRe = /\[projects\."([^"]+)"\]([\s\S]*?)(?=\n\[|$)/g;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(text)) !== null) {
    const cwd = m[1]!;
    const body = m[2]!;
    const trustRe = /trust_level\s*=\s*"([^"]+)"/;
    const mt = trustRe.exec(body);
    out.push({ cwd, trustLevel: mt ? mt[1]! : "?" });
  }
  return out;
}

function findLatestSession(home: string): string | null {
  const root = path.join(home, ".codex", "sessions");
  type Best = { path: string; mtime: number };
  let best: Best | null = null;
  const walk = (dir: string, depth: number): void => {
    if (depth > 5) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        try {
          const st = fs.statSync(full);
          if (!best || st.mtimeMs > best.mtime) {
            best = { path: full, mtime: st.mtimeMs };
          }
        } catch {
          /* unreadable */
        }
      }
    }
  };
  walk(root, 0);
  return best ? (best as Best).path : null;
}
