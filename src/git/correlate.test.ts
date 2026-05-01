import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateProjectYield,
  correlateSessionYield,
  findProjectGitRoot,
  listCommits,
  mondayOfWeekIso,
  type Commit,
} from "./correlate.js";
import type { SessionSummary } from "../store/sqlite.js";

let workspace: string;
let repo: string;

function gitInit(path: string): void {
  execSync(`git init -q ${path}`);
  execSync(`git -C ${path} config user.email agent@test`);
  execSync(`git -C ${path} config user.name agent`);
  execSync(`git -C ${path} config commit.gpgsign false`);
}

function commit(repoPath: string, file: string, content: string, msg: string, ts: string): void {
  writeFileSync(join(repoPath, file), content);
  execSync(`git -C ${repoPath} add ${file}`);
  execSync(
    `GIT_AUTHOR_DATE='${ts}' GIT_COMMITTER_DATE='${ts}' git -C ${repoPath} commit -q -m '${msg.replace(/'/g, "")}' --no-gpg-sign`,
  );
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "agentwatch-yield-ws-"));
  repo = join(workspace, "demo");
  execSync(`mkdir -p ${repo}`);
  gitInit(repo);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("git/correlate — findProjectGitRoot", () => {
  it("returns the absolute path when the project dir contains a .git folder", () => {
    const root = findProjectGitRoot(workspace, "demo");
    expect(root).not.toBeNull();
    expect(root).toMatch(/\/demo$/);
  });

  it("returns null when the directory exists but has no .git", () => {
    execSync(`mkdir -p ${join(workspace, "no-repo")}`);
    expect(findProjectGitRoot(workspace, "no-repo")).toBeNull();
  });

  it("returns null when the project dir doesn't exist", () => {
    expect(findProjectGitRoot(workspace, "missing")).toBeNull();
  });

  it("returns null for a non-existent workspace", () => {
    expect(findProjectGitRoot("/does/not/exist", "demo")).toBeNull();
  });
});

describe("git/correlate — listCommits", () => {
  it("returns commits with ISO author dates, insertions, and deletions", () => {
    commit(repo, "a.txt", "hello\n", "first", "2026-04-10T10:00:00Z");
    commit(repo, "a.txt", "hello\nworld\n", "second", "2026-04-11T10:00:00Z");
    const commits = listCommits(repo);
    expect(commits).toHaveLength(2);
    expect(commits[0]?.subject).toBe("first");
    expect(commits[0]?.authorDate.startsWith("2026-04-10")).toBe(true);
    expect(commits[0]?.insertions).toBeGreaterThanOrEqual(1);
    expect(commits[1]?.subject).toBe("second");
    expect(commits[1]?.insertions).toBeGreaterThanOrEqual(1);
  });

  it("filters by --since / --until", () => {
    commit(repo, "a.txt", "1\n", "old", "2026-03-01T00:00:00Z");
    commit(repo, "a.txt", "2\n", "new", "2026-04-15T00:00:00Z");
    const commits = listCommits(repo, { since: "2026-04-01T00:00:00Z" });
    expect(commits).toHaveLength(1);
    expect(commits[0]?.subject).toBe("new");
  });

  it("returns [] for a non-git directory", () => {
    expect(listCommits(workspace)).toEqual([]);
  });
});

describe("git/correlate — correlateSessionYield", () => {
  function session(over: Partial<SessionSummary>): SessionSummary {
    return {
      sessionId: over.sessionId ?? "s",
      agent: over.agent ?? "claude-code",
      project: over.project ?? "demo",
      firstTs: over.firstTs ?? "2026-04-10T10:00:00Z",
      lastTs: over.lastTs ?? "2026-04-10T11:00:00Z",
      eventCount: over.eventCount ?? 1,
      costUsd: over.costUsd ?? 1.0,
    };
  }

  function commitFixture(over: Partial<Commit>): Commit {
    return {
      hash: over.hash ?? "h",
      authorDate: over.authorDate ?? "2026-04-10T10:30:00Z",
      authorName: over.authorName ?? "agent",
      filesChanged: over.filesChanged ?? 1,
      insertions: over.insertions ?? 5,
      deletions: over.deletions ?? 2,
      subject: over.subject ?? "msg",
    };
  }

  it("matches commits inside the session window + 30 min grace", () => {
    const inWindow = commitFixture({ hash: "in", authorDate: "2026-04-10T11:20:00Z" });
    const tooLate = commitFixture({ hash: "late", authorDate: "2026-04-10T12:00:00Z" });
    const tooEarly = commitFixture({ hash: "early", authorDate: "2026-04-10T09:30:00Z" });
    const y = correlateSessionYield(session({}), [inWindow, tooLate, tooEarly]);
    expect(y.commits.map((c) => c.hash)).toEqual(["in"]);
  });

  it("computes cost-per-commit + cost-per-line", () => {
    const c1 = commitFixture({ hash: "a", insertions: 4, deletions: 1 }); // 5 lines
    const c2 = commitFixture({ hash: "b", insertions: 3, deletions: 2 }); // 5 lines
    const y = correlateSessionYield(session({ costUsd: 2.0 }), [c1, c2]);
    expect(y.costPerCommit).toBeCloseTo(1.0);
    expect(y.costPerLineChanged).toBeCloseTo(2.0 / 10);
    expect(y.totalInsertions).toBe(7);
    expect(y.totalDeletions).toBe(3);
    expect(y.totalFilesChanged).toBe(2);
  });

  it("returns null cost-per-* when no commits match", () => {
    const y = correlateSessionYield(session({}), []);
    expect(y.commits).toEqual([]);
    expect(y.costPerCommit).toBeNull();
    expect(y.costPerLineChanged).toBeNull();
  });
});

describe("git/correlate — aggregateProjectYield", () => {
  it("buckets cost + commits per ISO week and surfaces spend-without-commit", () => {
    const sessions: SessionSummary[] = [
      {
        sessionId: "s1",
        agent: "claude-code",
        project: "demo",
        firstTs: "2026-04-06T10:00:00Z", // Monday → 2026-04-06
        lastTs: "2026-04-06T11:00:00Z",
        eventCount: 5,
        costUsd: 2.0,
      },
      {
        sessionId: "s2",
        agent: "claude-code",
        project: "demo",
        firstTs: "2026-04-13T10:00:00Z", // Monday → 2026-04-13
        lastTs: "2026-04-13T11:00:00Z",
        eventCount: 5,
        costUsd: 1.0,
      },
      {
        sessionId: "s3",
        agent: "claude-code",
        project: "demo",
        firstTs: "2026-04-20T10:00:00Z",
        lastTs: "2026-04-20T11:00:00Z",
        eventCount: 5,
        costUsd: 0.5, // no commits this week
      },
    ];
    const commits: Commit[] = [
      {
        hash: "c1",
        authorDate: "2026-04-06T10:30:00Z",
        authorName: "x",
        filesChanged: 1,
        insertions: 5,
        deletions: 0,
        subject: "x",
      },
      {
        hash: "c2",
        authorDate: "2026-04-13T10:30:00Z",
        authorName: "x",
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
        subject: "y",
      },
    ];
    const yld = aggregateProjectYield("demo", sessions, commits);
    expect(yld.weekly.length).toBe(3);
    const wk1 = yld.weekly.find((w) => w.weekStart === "2026-04-06");
    expect(wk1?.commits).toBe(1);
    expect(wk1?.costPerCommit).toBeCloseTo(2.0);
    const wk3 = yld.weekly.find((w) => w.weekStart === "2026-04-20");
    expect(wk3?.commits).toBe(0);
    expect(wk3?.costPerCommit).toBeNull();
    expect(yld.spendWithoutCommit).toHaveLength(1);
    expect(yld.spendWithoutCommit[0]?.sessionId).toBe("s3");
  });
});

describe("git/correlate — mondayOfWeekIso", () => {
  it("snaps a Wednesday to the preceding Monday", () => {
    expect(mondayOfWeekIso("2026-04-08T15:00:00Z")).toBe("2026-04-06");
  });

  it("returns the same Monday when the input is already Monday", () => {
    expect(mondayOfWeekIso("2026-04-06T00:00:00Z")).toBe("2026-04-06");
  });

  it("snaps a Sunday back to the preceding Monday (ISO week)", () => {
    expect(mondayOfWeekIso("2026-04-12T23:00:00Z")).toBe("2026-04-06");
  });
});
