import { beforeEach, describe, expect, it } from "vitest";
import { _resetBranchCache, resolveWorkspace } from "./branch-cache.js";

beforeEach(() => {
  _resetBranchCache();
});

describe("resolveWorkspace — null cwd inputs", () => {
  it("returns null/null for an undefined cwd without shelling out", () => {
    let calls = 0;
    const r = resolveWorkspace(undefined, {
      branchOf: () => {
        calls++;
        return "main";
      },
    });
    expect(r).toEqual({ workspaceRoot: null, gitBranch: null });
    expect(calls).toBe(0);
  });

  it("returns null/null for an empty-string cwd without shelling out", () => {
    let calls = 0;
    const r = resolveWorkspace("", {
      branchOf: () => {
        calls++;
        return "main";
      },
    });
    expect(r).toEqual({ workspaceRoot: null, gitBranch: null });
    expect(calls).toBe(0);
  });
});

describe("resolveWorkspace — caching behaviour", () => {
  it("re-uses the cached branch within the TTL", () => {
    let calls = 0;
    const branchOf = (): string | null => {
      calls++;
      return "main";
    };
    const now = (): number => 1_000_000;
    const a = resolveWorkspace("/repo/a", { branchOf, now });
    const b = resolveWorkspace("/repo/a", { branchOf, now });
    expect(calls).toBe(1);
    expect(a.gitBranch).toBe("main");
    expect(b.gitBranch).toBe("main");
    // workspaceRoot may have been gitCommonDir-resolved or fall back to cwd
    expect(a.workspaceRoot).toBe(b.workspaceRoot);
  });

  it("re-shells when the cache entry is older than the TTL", () => {
    let calls = 0;
    const branchOf = (): string | null => {
      calls++;
      return calls === 1 ? "main" : "feature";
    };
    let t = 1_000_000;
    const now = (): number => t;
    const first = resolveWorkspace("/repo/b", { branchOf, now });
    expect(first.gitBranch).toBe("main");
    t += 60_001; // just past the 60 s TTL
    const second = resolveWorkspace("/repo/b", { branchOf, now });
    expect(second.gitBranch).toBe("feature");
    expect(calls).toBe(2);
  });

  it("caches a null branch the same way as a real branch", () => {
    let calls = 0;
    const branchOf = (): string | null => {
      calls++;
      return null;
    };
    const now = (): number => 2_000_000;
    const a = resolveWorkspace("/repo/c", { branchOf, now });
    const b = resolveWorkspace("/repo/c", { branchOf, now });
    expect(a.gitBranch).toBeNull();
    expect(b.gitBranch).toBeNull();
    expect(calls).toBe(1);
  });
});
