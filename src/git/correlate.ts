import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SessionSummary } from "../store/sqlite.js";

export interface Commit {
  hash: string;
  authorDate: string; // ISO
  authorName: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  subject: string;
}

export interface SessionYield {
  sessionId: string;
  costUsd: number;
  commits: Commit[];
  totalInsertions: number;
  totalDeletions: number;
  totalFilesChanged: number;
  costPerCommit: number | null;
  costPerLineChanged: number | null;
}

export interface ProjectYieldRow {
  weekStart: string; // ISO Monday of the bucket
  costUsd: number;
  commits: number;
  costPerCommit: number | null;
}

export interface ProjectYield {
  project: string;
  weekly: ProjectYieldRow[];
  spendWithoutCommit: SessionYield[];
}

/** Window the session is allowed to claim commits in: [first_ts,
 *  last_ts + COMMIT_GRACE_MS]. The grace period accommodates the
 *  natural gap between the agent finishing edits and the human / agent
 *  running `git commit`. */
const COMMIT_GRACE_MS = 30 * 60 * 1000;

/** Read-only — never invoke mutating git verbs. The worst this can do
 *  is fail to start (no git on PATH) or time out. */
const READ_ONLY_GIT_VERBS = new Set([
  "log",
  "rev-parse",
  "worktree",
  "config",
  "branch",
  "show",
  "blame",
  "diff",
  "status",
  "remote",
]);

function runGit(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): string {
  const verb = args[0];
  if (!verb || !READ_ONLY_GIT_VERBS.has(verb)) {
    // Defensive — refuse to spawn git with a verb that could mutate
    // state. This module is read-only by contract.
    throw new Error(`git verb "${verb}" not in read-only allow-list`);
  }
  const result = spawnSync("git", args, {
    cwd: opts.cwd,
    encoding: "utf-8",
    timeout: opts.timeoutMs ?? 10_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${result.status}: ${result.stderr.slice(0, 500)}`,
    );
  }
  return result.stdout;
}

/** Discover the canonical git root for a `[name]` project tag.
 *
 *  Rule: walk one level under `workspaceRoot` looking for a directory
 *  whose basename matches `projectName` and which contains a `.git`
 *  entry (directory for a normal repo, file for a worktree). For
 *  worktrees we resolve via `git rev-parse --git-common-dir` so two
 *  paths sharing the same backing repo are treated as one project. */
export function findProjectGitRoot(
  workspaceRoot: string,
  projectName: string,
): string | null {
  if (!existsSync(workspaceRoot)) return null;
  let entries: string[];
  try {
    entries = readdirSync(workspaceRoot);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry !== projectName) continue;
    const candidate = join(workspaceRoot, entry);
    try {
      const s = statSync(candidate);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }
    const gitEntry = join(candidate, ".git");
    if (!existsSync(gitEntry)) continue;
    return resolve(candidate);
  }
  return null;
}

/** Get the canonical common-dir for a worktree so two checkouts of
 *  the same repo aren't double-counted. Returns `null` for the input
 *  path itself if `git rev-parse` fails. */
export function gitCommonDir(repoPath: string): string | null {
  try {
    const out = runGit(["rev-parse", "--git-common-dir"], { cwd: repoPath });
    const trimmed = out.trim();
    if (!trimmed) return null;
    // git rev-parse returns a relative path on some systems; normalize.
    return resolve(repoPath, trimmed);
  } catch {
    return null;
  }
}

/** Current branch name at `repoPath`. Returns `null` for non-git dirs,
 *  detached HEAD (where `--abbrev-ref HEAD` reports the literal string
 *  `HEAD`), or any git failure. AUR-276 uses this — wrap with the
 *  branch-cache helper before calling on a hot path. */
export function getCurrentBranch(repoPath: string): string | null {
  try {
    const out = runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath });
    const branch = out.trim();
    if (!branch || branch === "HEAD") return null;
    return branch;
  } catch {
    return null;
  }
}

/** List commits in `[since, until]` (both ISO). Returns oldest-first.
 *  Skips merge commits (--no-merges) so the cost-per-commit metric
 *  isn't diluted by routine integration commits. */
export function listCommits(
  repoPath: string,
  opts: { since?: string; until?: string } = {},
): Commit[] {
  const args = ["log", "--no-merges", "--reverse"];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  // Format: STX prefix on every commit header so the parser can split
  // records cleanly even though --numstat injects extra lines between
  // commits. Field separator is unit-separator (\x1f) — robust against
  // tabs and newlines in subjects.
  args.push("--pretty=format:%x02%H%x1f%aI%x1f%an%x1f%s", "--numstat");
  let out: string;
  try {
    out = runGit(args, { cwd: repoPath });
  } catch {
    return [];
  }
  const records = out.split("\x02").map((r) => r.trim()).filter(Boolean);
  const commits: Commit[] = [];
  for (const rec of records) {
    const headerEnd = rec.indexOf("\n");
    const header = headerEnd === -1 ? rec : rec.slice(0, headerEnd);
    const numstat = headerEnd === -1 ? "" : rec.slice(headerEnd + 1);
    const [hash, authorDate, authorName, subject] = header.split("\x1f");
    if (!hash || !authorDate) continue;
    let insertions = 0;
    let deletions = 0;
    let files = 0;
    for (const line of numstat.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const ins = parts[0] === "-" ? 0 : Number(parts[0] ?? "0");
      const del = parts[1] === "-" ? 0 : Number(parts[1] ?? "0");
      if (Number.isFinite(ins)) insertions += ins;
      if (Number.isFinite(del)) deletions += del;
      files += 1;
    }
    commits.push({
      hash,
      authorDate,
      authorName: authorName ?? "",
      filesChanged: files,
      insertions,
      deletions,
      subject: subject ?? "",
    });
  }
  return commits;
}

/** Pair a session with the commits whose author_date sits inside the
 *  session window (first_ts → last_ts + 30min grace). Yields the
 *  cost-per-commit and cost-per-line metrics for the UI. */
export function correlateSessionYield(
  session: SessionSummary,
  commits: Commit[],
): SessionYield {
  const firstMs = Date.parse(session.firstTs);
  const lastMs = Date.parse(session.lastTs);
  const upper = Number.isFinite(lastMs) ? lastMs + COMMIT_GRACE_MS : Infinity;
  const lower = Number.isFinite(firstMs) ? firstMs : -Infinity;

  const matched = commits.filter((c) => {
    const t = Date.parse(c.authorDate);
    if (!Number.isFinite(t)) return false;
    return t >= lower && t <= upper;
  });

  let totalInsertions = 0;
  let totalDeletions = 0;
  let totalFiles = 0;
  for (const c of matched) {
    totalInsertions += c.insertions;
    totalDeletions += c.deletions;
    totalFiles += c.filesChanged;
  }
  const totalLines = totalInsertions + totalDeletions;
  return {
    sessionId: session.sessionId,
    costUsd: session.costUsd,
    commits: matched,
    totalInsertions,
    totalDeletions,
    totalFilesChanged: totalFiles,
    costPerCommit: matched.length > 0 ? session.costUsd / matched.length : null,
    costPerLineChanged: totalLines > 0 ? session.costUsd / totalLines : null,
  };
}

/** Aggregate yields across every session in a project — weekly cost-
 *  per-commit + a list of "spend without commit" sessions where the
 *  agent burned dollars but produced no commits. */
export function aggregateProjectYield(
  project: string,
  sessions: SessionSummary[],
  commits: Commit[],
): ProjectYield {
  const yields = sessions.map((s) => correlateSessionYield(s, commits));
  const weekly = new Map<string, { cost: number; commits: Set<string> }>();
  for (const y of yields) {
    const session = sessions.find((s) => s.sessionId === y.sessionId);
    if (!session) continue;
    const week = mondayOfWeekIso(session.firstTs);
    let bucket = weekly.get(week);
    if (!bucket) {
      bucket = { cost: 0, commits: new Set() };
      weekly.set(week, bucket);
    }
    bucket.cost += session.costUsd;
    for (const c of y.commits) bucket.commits.add(c.hash);
  }
  const weeklyRows: ProjectYieldRow[] = Array.from(weekly.entries())
    .map(([weekStart, b]) => ({
      weekStart,
      costUsd: b.cost,
      commits: b.commits.size,
      costPerCommit: b.commits.size > 0 ? b.cost / b.commits.size : null,
    }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const spendWithoutCommit = yields
    .filter((y) => y.commits.length === 0 && y.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd);
  return { project, weekly: weeklyRows, spendWithoutCommit };
}

export function mondayOfWeekIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getUTCDay(); // 0..6 (Sun..Sat)
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + offsetToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}
