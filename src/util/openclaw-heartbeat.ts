import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * OpenClaw HEARTBEAT.md parser.
 *
 * Heartbeat in OpenClaw is a periodic main-session turn (interval is
 * configured per agent in gateway config — see `agents.defaults.heartbeat`).
 * The HEARTBEAT.md file in each workspace holds the user-curated
 * checklist the agent reads on each fire. Empty / template HEARTBEAT.md
 * → heartbeat skipped with `reason=empty-heartbeat-file`.
 *
 * The file convention varies. We accept either:
 *
 *   # Anything header
 *
 *   ## tasks
 *   - Check inbox for urgent emails
 *   - Summarise yesterday's commits
 *
 * Or freeform paragraphs (we capture the first non-empty line as a
 * single task). Comments-only files (lines starting with `#` only) and
 * empty files are reported as having zero tasks.
 */

export interface HeartbeatTask {
  text: string;
  /** Source workspace label (e.g. `workspace-main`). */
  workspace: string;
  /** Absolute path to the HEARTBEAT.md the task came from. */
  source: string;
}

export interface HeartbeatStatus {
  workspace: string;
  source: string;
  tasks: HeartbeatTask[];
  /** True when the file exists but contains only comments or blank
   *  lines (matches the `reason=empty-heartbeat-file` skip). */
  empty: boolean;
}

const COMMENT_LINE = /^\s*(?:>|<!--|```|#)/;
const TASKS_HEADER = /^\s*##\s*tasks\s*$/i;

export function readHeartbeatFile(file: string): HeartbeatStatus | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const workspace = path.basename(path.dirname(file));
  const lines = raw.split("\n");
  const tasks: HeartbeatTask[] = [];
  let inTasksBlock = false;
  let sawAnyContent = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") continue;
    if (TASKS_HEADER.test(line)) {
      inTasksBlock = true;
      continue;
    }
    // Header that isn't `## tasks` ends the tasks block.
    if (line.startsWith("##") || line.startsWith("# ")) {
      if (inTasksBlock) inTasksBlock = false;
      continue;
    }
    if (COMMENT_LINE.test(line)) {
      continue;
    }
    sawAnyContent = true;
    if (inTasksBlock && /^\s*[-*+]\s+/.test(line)) {
      tasks.push({
        text: line.replace(/^\s*[-*+]\s+/, "").trim(),
        workspace,
        source: file,
      });
    } else if (!inTasksBlock && tasks.length === 0) {
      // No tasks block — treat the first non-empty paragraph as one task
      // so the user gets *something* on the dashboard.
      tasks.push({ text: line.trim(), workspace, source: file });
    }
  }

  return {
    workspace,
    source: file,
    tasks,
    empty: !sawAnyContent || tasks.length === 0,
  };
}

/** Discover every HEARTBEAT.md inside ~/.openclaw/workspace-* dirs. */
export function discoverHeartbeatFiles(home: string = os.homedir()): string[] {
  const root = path.join(home, ".openclaw");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith("workspace")) continue;
    const candidate = path.join(root, e.name, "HEARTBEAT.md");
    try {
      fs.statSync(candidate);
      out.push(candidate);
    } catch {
      /* missing — skip */
    }
  }
  return out;
}

/** Convenience: scan all heartbeat files at once. */
export function readAllHeartbeats(home: string = os.homedir()): HeartbeatStatus[] {
  return discoverHeartbeatFiles(home)
    .map((f) => readHeartbeatFile(f))
    .filter((s): s is HeartbeatStatus => s !== null);
}
