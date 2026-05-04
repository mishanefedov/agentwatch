import { getCurrentBranch, gitCommonDir } from "../git/correlate.js";

/** AUR-276: cache git-branch lookups per workspace root for `TTL_MS`.
 *  `getCurrentBranch` shells out to `git`, which is cheap (~3–10 ms) but
 *  hot-path file_write events fire often enough that a tight cache pays.
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
  branch: string | null;
  refreshedMs: number;
}

const cache = new Map<string, CacheEntry>();

interface BranchCacheDeps {
  /** Override for tests. Defaults to the real git shell-out. */
  branchOf?: (root: string) => string | null;
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface ResolvedWorkspace {
  /** Canonicalized workspace root (gitCommonDir-resolved if possible).
   *  `null` when the input cwd was null/empty or git couldn't resolve it. */
  workspaceRoot: string | null;
  /** Current branch at the workspace root, or `null` (see TTL note above). */
  gitBranch: string | null;
}

/** Resolve `(workspaceRoot, gitBranch)` for the given cwd, with a
 *  60-second cache around the git invocation. Pure-data return; the
 *  caller decides what to do with nulls (the AUR-276 linker uses null
 *  as a "do not match" gate). */
export function resolveWorkspace(
  cwd: string | null | undefined,
  deps: BranchCacheDeps = {},
): ResolvedWorkspace {
  if (!cwd) return { workspaceRoot: null, gitBranch: null };
  const root = gitCommonDir(cwd) ?? cwd;
  const branchOf = deps.branchOf ?? getCurrentBranch;
  const now = deps.now ?? Date.now;
  const cached = cache.get(root);
  const t = now();
  if (cached && t - cached.refreshedMs < TTL_MS) {
    return { workspaceRoot: root, gitBranch: cached.branch };
  }
  const branch = branchOf(root);
  cache.set(root, { branch, refreshedMs: t });
  return { workspaceRoot: root, gitBranch: branch };
}

/** Test-only: drop every cached entry. */
export function _resetBranchCache(): void {
  cache.clear();
}
