import { beforeEach, describe, expect, it } from "vitest";
import { _resetBranchCache, resolveWorkspace } from "./branch-cache.js";

beforeEach(() => {
  _resetBranchCache();
});

describe("resolveWorkspace — null cwd inputs", () => {
  it("returns null/null for an undefined cwd without shelling out", () => {
    let branchCalls = 0;
    let commonDirCalls = 0;
    const r = resolveWorkspace(undefined, {
      branchOf: () => {
        branchCalls++;
        return "main";
      },
      commonDirOf: () => {
        commonDirCalls++;
        return null;
      },
    });
    expect(r).toEqual({ workspaceRoot: null, gitBranch: null });
    expect(branchCalls).toBe(0);
    expect(commonDirCalls).toBe(0);
  });

  it("returns null/null for an empty-string cwd without shelling out", () => {
    let branchCalls = 0;
    let commonDirCalls = 0;
    const r = resolveWorkspace("", {
      branchOf: () => {
        branchCalls++;
        return "main";
      },
      commonDirOf: () => {
        commonDirCalls++;
        return null;
      },
    });
    expect(r).toEqual({ workspaceRoot: null, gitBranch: null });
    expect(branchCalls).toBe(0);
    expect(commonDirCalls).toBe(0);
  });
});

describe("resolveWorkspace — caching behaviour", () => {
  it("re-uses both cached values within the TTL — no shell-outs on hit", () => {
    let branchCalls = 0;
    let commonDirCalls = 0;
    const branchOf = (): string | null => {
      branchCalls++;
      return "main";
    };
    const commonDirOf = (): string | null => {
      commonDirCalls++;
      return "/repo/.git";
    };
    const now = (): number => 1_000_000;
    const a = resolveWorkspace("/repo/a", { branchOf, commonDirOf, now });
    const b = resolveWorkspace("/repo/a", { branchOf, commonDirOf, now });
    expect(branchCalls).toBe(1);
    expect(commonDirCalls).toBe(1); // regression guard: no shell-out on hit
    expect(a).toEqual(b);
    expect(a.gitBranch).toBe("main");
    expect(a.workspaceRoot).toBe("/repo/.git");
  });

  it("re-shells when the cache entry is older than the TTL", () => {
    let branchCalls = 0;
    const branchOf = (): string | null => {
      branchCalls++;
      return branchCalls === 1 ? "main" : "feature";
    };
    const commonDirOf = (): string | null => "/repo/.git";
    let t = 1_000_000;
    const now = (): number => t;
    const first = resolveWorkspace("/repo/b", { branchOf, commonDirOf, now });
    expect(first.gitBranch).toBe("main");
    t += 60_001; // just past the 60 s TTL
    const second = resolveWorkspace("/repo/b", { branchOf, commonDirOf, now });
    expect(second.gitBranch).toBe("feature");
    expect(branchCalls).toBe(2);
  });

  it("caches a null branch the same way as a real branch", () => {
    let branchCalls = 0;
    const branchOf = (): string | null => {
      branchCalls++;
      return null;
    };
    const now = (): number => 2_000_000;
    const a = resolveWorkspace("/repo/c", {
      branchOf,
      commonDirOf: () => null,
      now,
    });
    const b = resolveWorkspace("/repo/c", {
      branchOf,
      commonDirOf: () => null,
      now,
    });
    expect(a.gitBranch).toBeNull();
    expect(b.gitBranch).toBeNull();
    expect(branchCalls).toBe(1);
  });

  it("does NOT collapse linked worktrees that share a common-dir but differ on branch", () => {
    // Two worktrees of the same repo, different branches. The previous
    // (codex-flagged) keying-by-common-dir would cross-poison them; this
    // version keys by cwd so each worktree has its own cache entry.
    const commonDirOf = (): string | null => "/repo/.git"; // shared
    const branchOf = (cwd: string): string | null =>
      cwd === "/repo/main-worktree" ? "main" : "feature";
    const now = (): number => 5_000_000;
    const a = resolveWorkspace("/repo/main-worktree", {
      branchOf,
      commonDirOf,
      now,
    });
    const b = resolveWorkspace("/repo/feature-worktree", {
      branchOf,
      commonDirOf,
      now,
    });
    expect(a.gitBranch).toBe("main");
    expect(b.gitBranch).toBe("feature");
    // Both still resolve to the SAME workspaceRoot — the matcher gates
    // on (workspaceRoot, branch) together, and on-same-branch worktrees
    // SHOULD collapse, while different-branch ones diverge on branch.
    expect(a.workspaceRoot).toBe(b.workspaceRoot);
  });
});
