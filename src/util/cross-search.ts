import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentName } from "../schema.js";

export interface SearchHit {
  agent: AgentName;
  sessionId: string;
  project: string;
  path: string;
  lineNumber: number;
  line: string;
}

const MAX_LINE = 500;

/** Cross-session text search spanning every local agent history file we
 *  know about (~/.claude/projects, ~/.codex/sessions). Prefers ripgrep
 *  for speed; falls back to a native scan when rg isn't installed. */
export function searchAllSessions(
  query: string,
  limit: number = 50,
  home: string = os.homedir(),
): SearchHit[] {
  if (!query) return [];
  const roots = sessionRoots(home);
  if (roots.length === 0) return [];
  const rg = hasRipgrep();
  const hits = rg
    ? searchWithRipgrep(query, roots, limit)
    : searchNative(query, roots, limit);
  return hits.slice(0, limit);
}

function sessionRoots(home: string): string[] {
  const out: string[] = [];
  const claude = path.join(home, ".claude", "projects");
  if (fs.existsSync(claude)) out.push(claude);
  const codex = path.join(home, ".codex", "sessions");
  if (fs.existsSync(codex)) out.push(codex);
  const gemini = path.join(home, ".gemini", "tmp");
  if (fs.existsSync(gemini)) out.push(gemini);
  return out;
}

function hasRipgrep(): boolean {
  try {
    const r = spawnSync("rg", ["--version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

function searchWithRipgrep(
  query: string,
  roots: string[],
  limit: number,
): SearchHit[] {
  const args = [
    "--fixed-strings",
    "--ignore-case",
    "--no-heading",
    "--line-number",
    "--glob",
    "*.{jsonl,json}",
    query,
    ...roots,
  ];
  const r = spawnSync("rg", args, { encoding: "utf8" });
  if (r.status !== 0 && r.status !== 1) return [];
  const hits: SearchHit[] = [];
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line) continue;
    const m = line.match(/^(.+?):(\d+):(.*)$/);
    if (!m) continue;
    const hit = hitFromPath(m[1]!, Number(m[2]), m[3]!);
    if (hit) hits.push(hit);
    if (hits.length >= limit) break;
  }
  return hits;
}

function searchNative(
  query: string,
  roots: string[],
  limit: number,
): SearchHit[] {
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (hits.length >= limit) return hits;
      if (!file.endsWith(".jsonl") && !file.endsWith(".json")) continue;
      try {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length && hits.length < limit; i++) {
          if (lines[i]!.toLowerCase().includes(needle)) {
            const hit = hitFromPath(file, i + 1, lines[i]!);
            if (hit) hits.push(hit);
          }
        }
      } catch {
        /* unreadable */
      }
    }
  }
  return hits;
}

function* walk(dir: string): IterableIterator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

function hitFromPath(
  file: string,
  lineNumber: number,
  line: string,
): SearchHit | null {
  const trimmed = line.length > MAX_LINE ? line.slice(0, MAX_LINE) + "…" : line;
  const isClaude = file.includes(path.sep + ".claude" + path.sep + "projects");
  const isCodex = file.includes(path.sep + ".codex" + path.sep + "sessions");
  const isGemini = file.includes(path.sep + ".gemini" + path.sep + "tmp");
  if (isClaude) {
    const parts = file.split(path.sep);
    const projIdx = parts.lastIndexOf("projects");
    const projectDir = parts[projIdx + 1] ?? "";
    const project = projectDir.split("-").filter(Boolean).slice(-1)[0] ?? projectDir;
    const sessionId = path.basename(file, ".jsonl");
    return {
      agent: "claude-code",
      sessionId,
      project,
      path: file,
      lineNumber,
      line: trimmed,
    };
  }
  if (isCodex) {
    const m = path.basename(file, ".jsonl").match(/rollout-[0-9T:\-.]+-(.+)$/);
    return {
      agent: "codex",
      sessionId: m?.[1] ?? path.basename(file, ".jsonl"),
      project: "",
      path: file,
      lineNumber,
      line: trimmed,
    };
  }
  if (isGemini) {
    // …/.gemini/tmp/<project>/chats/session-YYYY-MM-DDTHH-MM-<hash>.json
    const parts = file.split(path.sep);
    const tmpIdx = parts.lastIndexOf("tmp");
    const project = parts[tmpIdx + 1] ?? "";
    const base = path.basename(file, ".json");
    const m = base.match(/^session-[0-9T:\-]+-(.+)$/);
    return {
      agent: "gemini",
      sessionId: m?.[1] ?? base,
      project,
      path: file,
      lineNumber,
      line: trimmed,
    };
  }
  return null;
}
