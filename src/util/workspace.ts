import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function detectWorkspaceRoot(): string {
  const envRoot = process.env.WORKSPACE_ROOT;
  if (envRoot && isDir(envRoot)) return envRoot;

  const home = homedir();
  const candidates = [
    join(home, "IdeaProjects"),
    join(home, "src"),
    join(home, "code"),
    join(home, "Projects"),
    join(home, "dev"),
  ];
  for (const c of candidates) {
    if (isDir(c)) return c;
  }
  return home;
}

export function claudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}
