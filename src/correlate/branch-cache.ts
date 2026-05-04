import { getCurrentBranch, gitCommonDir } from "../git/correlate.js";

/** AUR-276: cache git-branch + git-common-dir lookups per *worktree*
 *  (cwd) for `TTL_MS`. Both lookups shell out to `git`, which is cheap
 *  individually (~3–10 ms each) but hot-path file_write events fire
 *  often enough that a tight cache pays — the previous version called
 *  `gitCommonDir` *before* the cache check, which defeated the cache
 *  for the common-dir lookup on every event.
 *
 *  Why the cache key is `cwd` (not `gitCommonDir(cwd)`):
 *  Linked worktrees of the same repo share a `.git` common-dir but
 *  point at different branches. Keying by common-dir would collapse
 *  them, so a write from worktree-A on `main` would poison the cache
 *  for a write from worktree-B on `feature` for the next 60 seconds —
 *  injecting wrong-branch attribution into exactly the telemetry data
 *  AUR-276 exists to measure. Branch is per-worktree; the cache must
 *  be per-worktree too.
 *
 *  The returned `workspaceRoot` is still `gitCommonDir(cwd) ?? cwd`,
 *  so two worktrees of the same repo on the same branch DO collapse
 *  into one workspace from the matcher's point of view (which is what
 *  we want: same repo + same branch = same task).
 *
 *  TTL is intentionally short (60 s): humans switch branches and then
 *  immediately run an agent on the new branch — we want stale entries
 *  to expire fast enough that the next file_write picks up the switch,
 *  but not so fast that we re-spawn git for every burst of writes.
 *
 *  Cache misses on a non-git dir, missing-git-on-PATH, or detached HEAD
 *  all return `null` and cache that null result for the same TTL — no
 *  point re-shelling-out to fail again 5 ms later.
 */

const TTL_MS = 60_000;

interface CacheEntry {
  workspaceRoot: string | null;
  branch: string | null;
  refreshedMs: number;
}

const cache = new Map<string, CacheEntry>();

interface BranchCacheDeps {
  /** Override for tests. Defaults to `getCurrentBranch` (shells out to git). */
  branchOf?: (cwd: string) => string | null;
  /** Override for tests. Defaults to `gitCommonDir` (shells out to git). */
  commonDirOf?: (cwd: string) => string | null;
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface ResolvedWorkspace {
  /** Canonicalized workspace root (gitCommonDir-resolved if possible).
   *  Two worktrees of the same repo collapse to the same value here —
   *  the matcher then gates on this + the per-worktree branch. `null`
   *  when the input cwd was null/empty or git couldn't resolve it. */
  workspaceRoot: string | null;
  /** Current branch at the *worktree* (cwd), not the common-dir, so
   *  sibling worktrees on different branches don't share a value.
   *  `null` for non-git, detached HEAD, or any git failure. */
  gitBranch: string | null;
}

/** Resolve `(workspaceRoot, gitBranch)` for the given cwd, with a
 *  60-second cache around the git invocations. Pure-data return; the
 *  caller decides what to do with nulls (the AUR-276 linker uses null
 *  as a "do not match" gate). */
export function resolveWorkspace(
  cwd: string | null | undefined,
  deps: BranchCacheDeps = {},
): ResolvedWorkspace {
  if (!cwd) return { workspaceRoot: null, gitBranch: null };
  const branchOf = deps.branchOf ?? getCurrentBranch;
  const commonDirOf = deps.commonDirOf ?? gitCommonDir;
  const now = deps.now ?? Date.now;
  const t = now();
  // Cache lookup BEFORE any subprocess. The previous version paid for
  // gitCommonDir on every call — this version pays for nothing on hits.
  const cached = cache.get(cwd);
  if (cached && t - cached.refreshedMs < TTL_MS) {
    return { workspaceRoot: cached.workspaceRoot, gitBranch: cached.branch };
  }
  // Miss: resolve both, cache once.
  const workspaceRoot = commonDirOf(cwd) ?? cwd;
  const branch = branchOf(cwd);
  cache.set(cwd, { workspaceRoot, branch, refreshedMs: t });
  return { workspaceRoot, gitBranch: branch };
}

/** Test-only: drop every cached entry. */
export function _resetBranchCache(): void {
  cache.clear();
}
