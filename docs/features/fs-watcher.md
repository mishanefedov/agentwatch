# Filesystem watcher

## Contract

**GOAL:** Emit timeline events for workspace file changes that no instrumented adapter attributed.
**USER_VALUE:** Catch writes from manual edits or non-instrumented agents (Aider, Cline, Windsurf) so the timeline isn't blind.
**COUNTERFACTUAL:** Multi-agent users see a partial picture — only the instrumented agents — while unrelated writes silently change their tree.

## What it does

A catch-all for file changes in your workspace that didn't come from
an instrumented agent. Fires for manual edits, non-instrumented agents
(Aider, Codex, Cline, Windsurf when they land), and any other source.

Deduped against agent-attributed writes so Claude/OpenClaw writes don't
appear twice.

## How it starts

Automatic at App mount. Watches `$WORKSPACE_ROOT` (default
`~/IdeaProjects`, fallback chain: `~/src` → `~/code` → `~/Projects` →
`~/dev` → `$HOME`).

## Inputs

`src/adapters/fs-watcher.ts`:
- chokidar `depth: 3`
- Ignore list: `node_modules`, `.git`, `dist`, `build`, `.next`,
  `.cache`, `.turbo`, `target`, `coverage`, `.venv`, `venv`,
  `__pycache__`, `.pytest_cache`, `.idea`, `.vscode`, `*.log`, `*.lock`,
  `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`,
  `.DS_Store`
- Checks `wasRecentlyWrittenByAgent(path)` from
  `src/util/recent-writes.ts` before emitting — skips dedupe window
  (5s TTL, 30s purge)

## Outputs

Emits `type: "file_change"` events with `agent: "unknown"`. Summary =
the path. Risk computed per path pattern (reads of `.env` flagged).

## Failure modes

- **EMFILE / ENOSPC / EACCES**: swallowed silently. The watcher's error
  handler recognizes these and does not crash the process.
- **`$WORKSPACE_ROOT` doesn't exist**: falls through the default chain
  until one exists. Ultimately defaults to `$HOME`.
- **Huge workspace (>40k files)**: chokidar will struggle even with
  `depth: 3`. Not fully solved; documented as a known limitation. v0.4
  could add an auto-disable on EMFILE.

## Interactions

- Deduped against Claude + OpenClaw + Cursor adapter writes via
  `recent-writes.ts`. An adapter that writes a file marks the path; fs
  watcher skips that path for the next 5 seconds.
- `fs-watcher` is the fallback observability channel for
  detected-but-not-instrumented agents (Aider, Codex, Cline, Windsurf).
