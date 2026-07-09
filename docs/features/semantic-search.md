# Semantic search index

Hybrid BM25 + local sentence-embedding search over every turn in every
Claude / Codex / Gemini / OpenClaw session on disk. Runs entirely
local — no cloud, no telemetry — with one exception documented below.

## Contract

**GOAL:** Build and query a local hybrid (BM25 + embedding) search index over session history without ever blocking the TUI or web server's event loop.
**USER_VALUE:** Fuzzy, meaning-aware search across thousands of turns finds the right past conversation even when you don't remember the exact wording — and the TUI keeps responding to keys while the (1-3 min, first-run) build runs.
**COUNTERFACTUAL:** Building the index inline (as it did before this fix) freezes every key in the TUI for the whole build — on a heavy install (5k-10k turns), that's 1-3 minutes of an unresponsive terminal.

## How it works

- **Storage:** `~/.agentwatch/index.sqlite` — an FTS5 virtual table for
  BM25, a plain table of `Float32Array` embeddings (brute-force cosine,
  fine up to ~100k rows), and a single-row `reindex_meta` table used as
  the progress/lock channel described below.
- **Embeddings:** `BAAI/bge-small-en-v1.5` (384-dim, ONNX, q8-quantized),
  loaded via `@huggingface/transformers`. First use downloads ~80MB to
  `~/.agentwatch/models/` — **the one network call this feature makes**,
  and it only happens once a semantic search is actually requested.
- **Ranking:** Reciprocal Rank Fusion (k=60) over BM25 rank + cosine
  rank, so a turn that matches on both signals outranks one that only
  matches on one.

## The build always runs out-of-process

The build (walk every session file → group into turns → embed → write)
never runs inline in the TUI or in a web request handler. It's the
`agentwatch reindex` CLI subcommand, always launched as a **detached
subprocess**:

```
child_process.spawn(process.execPath, [...execArgv, entryScript, "reindex"], {
  detached: true,
  stdio: "ignore",
}).unref()
```

- The web search route (`POST /api/search` with `mode: "semantic"`)
  spawns it the first time semantic search is used, or when the
  existing index has gone stale (no build in the last 15 minutes) —
  see `shouldSpawnReindex` in `src/util/reindex-spawner.ts`. While the
  index is empty it serves BM25-only results with a `status` message
  instead of blocking the request.
- It can also be run by hand: `agentwatch reindex` (add `--quiet` to
  suppress stdout, e.g. from a cron job).
- Re-running it is always incremental — turn ids already in the index
  are skipped (`indexedIds()` in `src/util/semantic-index.ts`), so a
  background re-index only embeds turns written since the last build.

## Progress + cancel — the `reindex_meta` row

Because the build is a separate process, progress can't be pushed back
via a callback or IPC. Instead it writes a single-row `reindex_meta`
table in the same sqlite file it's building — `status` (`idle` |
`running` | `done` | `error` | `cancelled`), `pid`, `scannedFiles`,
`queuedTurns`, `embeddedTurns`, `skippedTurns`, timestamps. Any process
— the TUI, the web server, another CLI invocation — polls
`readReindexMeta()` to see it.

- **TUI footer** (`src/ui/App.tsx`) polls every 1.5s (only if
  `hasIndex()` — a plain `fs.existsSync`, so users who never touch
  semantic search pay nothing) and shows a yellow status line while
  `status === "running"`, never a blocking overlay.
- **Cancel:** press `x` in the TUI while a build is running, or send
  `SIGINT`/`SIGTERM` to the `agentwatch reindex` process directly. The
  builder checks the abort signal between files and between 32-turn
  batches and stops there; `upsertTurns()` writes each batch inside a
  SQLite transaction, so the db always reflects the last *fully
  written* batch — a cancel or a hard kill never leaves a half-written
  turn.
- **Duplicate builds:** `claimReindexLock()` refuses to start a second
  build while the recorded pid is still alive, so overlapping triggers
  (e.g. two browser tabs both firing the first semantic search) don't
  spawn a second process.

## Failure modes

- **Two tabs, one build.** Only the first spawns; the second sees the
  lock held and just polls.
- **Stale lock from a killed process.** `isPidAlive()` checks the
  recorded pid; if it's dead, the next attempt reclaims the lock
  instead of waiting forever.
- **Model download fails (offline).** The build throws, `reindex_meta`
  records `status: "error"` + the error text, and search keeps serving
  BM25 results — semantic mode never becomes required for search to
  work.
