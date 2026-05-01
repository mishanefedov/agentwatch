# Changelog

All notable changes to agentwatch are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

**What counts as breaking?** CLI flags, the `agentwatch doctor` output contract,
and the canonical event schema (`src/schema.ts`). Adapter internals and TUI
layout can change freely within a minor version.

## [Unreleased]

### Added — v0.1 foundation

- **SQLite event store** (AUR-263) at `~/.agentwatch/events.db` — replaces
  the 4 MB rolling backfill with a persistent indexed store. WAL mode
  + `synchronous=NORMAL` + FTS5 virtual table over prompt/response/
  thinking/tool_result/summary. Migrations are versioned (`schema_version`
  table). Three tables: `events` (canonical AgentEvent), `sessions`
  (auto-aggregated via trigger on event insert: cost, ts range, count,
  project), `tool_calls` (tool, duration, error). Bench: ingests 10k
  events in ~430ms on M1 air.
- **`agentwatch prune --older-than-days N`** — drops events older than
  the cutoff (default 90 days), VACUUMs the DB on non-trivial prunes,
  prints the resulting size.
- **Search history mode** — `POST /api/search` with `mode: "history"`
  hits the FTS5 index for full-history matches (vs the live ring buffer
  or the JSONL cross-scan). Returns FTS-ranked snippets.

### Changed

- **EventSink wired through the store** in both TUI and `serve` modes —
  every emit/enrich is now mirrored to SQLite. Failures are logged once
  and never propagated; the in-memory pipeline remains the source of
  truth for the live SSE stream.

## [0.0.3] — 2026-04-15

### Added — full multi-agent + moats wave

- **M5 parity-with-claude-devtools** — token attribution per turn
  (gpt-tokenizer cl100k_base; CLAUDE.md / AGENTS.md / GEMINI.md /
  .cursorrules / .windsurfrules / OPENCLAW.md as memory-file overhead),
  context compaction visualizer (`C`), syntax highlighting in detail
  pane (`cli-highlight`), session export to markdown + JSON (`e`),
  stale-session detection (`⊘ stale` after 5 min idle).
- **M6 differentiation moats** — user-defined regex / threshold
  notification triggers in `~/.agentwatch/triggers.json` (live-reloaded),
  per-session and per-day budget alarms in `~/.agentwatch/budgets.json`
  (banner + OS notification on breach), MCP server mode (`agentwatch mcp`)
  exposing 5 tools (`list_recent_sessions`, `get_session_events`,
  `search_sessions`, `get_tool_usage_stats`, `get_session_cost`),
  OpenTelemetry exporter (`AGENTWATCH_OTLP_ENDPOINT`) with `gen_ai.*`
  semantic conventions, cross-session search across every JSONL/JSON
  on disk.
- **M7 anomaly detection + semantic search** — MAD z-score outliers
  on cost / duration / tokens (configurable in
  `~/.agentwatch/anomaly.json`), period-1-to-4 stuck-loop detector,
  per-session aggregation with banner + dismiss (`D`) + timeline `◎`
  marker. Hybrid semantic search (`?` then `s`) using
  `bge-small-en-v1.5` (q8) via `@huggingface/transformers` v3 + SQLite
  FTS5 + Reciprocal Rank Fusion. First-run consent prompt before any
  download.
- **Codex adapter** — full session parsing including
  `function_call` / `function_call_output` pairing (toolResult,
  duration, error flag), `event_msg/token_count` enrichment, model
  capture from `session_meta` + `turn_context`, GPT-5 / GPT-5-mini
  cost rates.
- **Gemini adapter** — full token usage from each `gemini` message,
  `toolCalls[]` parsing into file_read / file_write / shell_exec /
  tool_call with inline functionResponse output, gemini-2.5-pro / flash
  cost rates.
- **OpenClaw adapter** — surfaces the precomputed `usage` + `cost`
  block from each assistant message (cacheWrite → cacheCreate map).
- **Codex + Gemini permission views** — `~/.codex/config.toml` projects
  + sandbox_policy from latest session's `turn_context`,
  `~/.gemini/settings.json` auth + tools allow/block + trusted folders.

### Changed
- README rewritten end-to-end to match shipped reality.
- Per-event cost / OTel spans now use the `gen_ai.*` OpenTelemetry
  semantic conventions instead of agentwatch-only attribute names.
- Codex / Gemini / OpenClaw memory files (AGENTS.md, GEMINI.md,
  .cursorrules, OPENCLAW.md) are read for token-attribution overhead
  alongside the existing CLAUDE.md.

### Performance
- Event dispatches coalesced at 16 ms during backfill — 500 emits
  collapse to 1 batched merge, removing render thrash on launch.
- All derived passes (anomaly, budget, projectIndex, sessionRows,
  childCountByAgentId) wrapped in `useMemo` — no longer recomputed
  on every keypress.
- Anomaly scoring now precomputes per-agent histories once instead of
  `slice + filter` per event.

### Behavior
- The generic file-system watcher of `WORKSPACE_ROOT` is now opt-in
  via `AGENTWATCH_WATCH_WORKSPACE=1`. On large monorepos it could
  exhaust inotify / take seconds to establish watches. Agent events
  (Claude / Codex / Gemini / OpenClaw) are unaffected.
- `q` / Ctrl-C now restore stdin raw mode reliably — the shell no
  longer freezes for ~1 minute after exit.

### Cancelled (with documented reasoning in Linear)
- Diff-attribution (AUR-182), cross-agent session correlation
  (AUR-183), replay mode (AUR-184). See ticket descriptions for the
  research record.

## [0.0.2] — 2026-04-14

### Added — claude-devtools parity (v0.3 feature wave)
- **Event detail pane** (`Enter`) — full-screen view of any event with
  tokens, cost, duration, tool input, tool result, full text, extended
  thinking. Scrollable with `↑↓` / `j k`.
- **Full-text search** (`/`) — narrows the timeline by summary / path /
  cmd / tool / agent / full text / thinking. Live match count.
- **Projects grid** (`P`) — one row per workspace on your machine,
  per-agent event counts, total cost, last-active time.
- **Sessions list** — bucketed by Today / Yesterday / Last 7 days /
  Older. Each row: agent tag, first user prompt, event count,
  duration, cost, error flag.
- **Scoped session timeline** — Enter a session to filter the main
  timeline to just that session's events.
- **Subagent drilldown** (`x`) — scope the timeline to the inner tool
  calls of a selected `Agent` spawn. `X` unscopes. Parent events show
  `▸ N child events` suffix.
- **Subagent JSONL ingestion** — `~/.claude/projects/*/SESSION/subagents/agent-*.jsonl`
  is now captured (previously invisible; 8.5k events surfaced on a
  typical dev machine).
- **Per-session cost with cache-hit accounting** — per-model rates
  (opus-4-6, sonnet-4-6, haiku-4-5) correctly weighting
  `cache_creation_input_tokens` (125%) and `cache_read_input_tokens`
  (10%). Naive summers are 3–10x wrong without this.
- **tool_use ↔ tool_result pairing** — captures duration, full output
  content, error flag for every Claude tool call.
- **Desktop notifications** — built-ins fire for `.env` access,
  `~/.ssh`/`.aws`/`.gnupg` paths, `rm -rf` / `sudo` / `curl | sh`, and
  tool errors. Rate-limited, backfill-silent.
- **Yank to clipboard** (`y`) — copies the most useful payload (tool
  result > full text > cmd > path) via `pbcopy` / `wl-copy` / `xclip`
  / `clip`.
- **Help overlay** (`?`) — grouped keybindings reference from any view.
- **Breadcrumb header** — surfaces active view + every active scope
  (project, session, subagent, agent, search).
- **Per-agent permission viewer** extended to Cursor (approval mode,
  sandbox, allow/deny, MCP servers, `.cursorrules`) and OpenClaw
  (default workspace, per-sub-agent model + workspace).

### Added — scaffold / discipline
- **CONTRIBUTING.md**, **SECURITY.md**, **CODE_OF_CONDUCT.md**.
- **Issue + PR templates** (bug, feature, adapter request).
- **`0` = home** — reset all filters / scopes / modals.
- **`Z` = clear filters** — replaces the confusing `A` case-variant.
- **`esc` = go back one level** — consistent across every view.

### Fixed
- **Claude adapter was reading zero events.** chokidar v4 dropped glob
  support; the `${dir}/**/*.jsonl` pattern never fired. Now watches
  the projects dir recursively with a path regex. Reveals thousands of
  events that were invisible in 0.0.1.
- **EMFILE crash** after ~30s of real use. Reduced FS watcher depth
  from 8 → 3, expanded ignores (coverage, `.venv`, `__pycache__`,
  `.turbo`, lock files), replaced Cursor's recursive workspace watcher
  with a one-shot shallow discovery + per-file watcher. All adapters
  silently swallow EMFILE / ENOSPC / EACCES instead of crashing.
- **`q` felt laggy** — chokidar's close waits on pending FDs. We now
  force `process.exit(0)` on quit.
- **Timeline rendered in arrival order**. Backfill arrived out of
  order. Now binary-inserted by event timestamp — strict
  reverse-chronological.
- **Empty-content events polluted the timeline.** Assistant messages
  with neither text nor tool_use are now suppressed.
- **Clipboard + notifier EBADF inside the TUI** — Ink's raw-mode TTY
  broke inherited stdio on spawnSync. Explicit pipe / ignore stdio on
  all child process calls.
- **fs-watcher double-counted Claude writes.** Introduced a
  module-scoped `recentAgentWrites` cache; fs-watcher skips paths
  an agent wrote within the last 5s.

### Changed
- Event `summary` now includes `[project]` prefix (Claude: extracted
  from session path; OpenClaw: from `cwd` in `session_start`; Cursor:
  path heuristic).
- Assistant tool_use events now extract real payload into summary
  instead of literal `tool_call`: `Bash: git log`, `Read: src/auth.ts`,
  `Task: refactor parser`, etc.
- Classification: Bash tool_use is now `shell_exec` (not `tool_call`)
  with elevated risk scoring for destructive commands.

### Notes
- Not cloud. Not an agent. Not telemetry-enabled. Zero outbound
  network calls.
- macOS + Linux. Windows intentionally out of scope for v0.
- Codex and Gemini adapters are intentionally deferred.

## [0.0.1] — 2026-04-14

### Fixed
- **Claude adapter silently reading zero events.** chokidar v4 dropped glob
  support; the `${dir}/**/*.jsonl` pattern never fired. Now watches the
  projects dir recursively with a path-regex filter. Live smoke surfaced
  thousands of events where 0.0.1 showed none.
- **EMFILE crash** after ~30 seconds of real use. Reduced FS watcher depth
  from 8 → 3, expanded the ignore list (coverage, `.venv`, `__pycache__`,
  `.turbo`, lock files), and replaced Cursor's recursive workspace watcher
  with a one-shot shallow discovery + per-file watcher. All adapters now
  silently swallow EMFILE / ENOSPC / EACCES instead of crashing.
- **`q` felt laggy.** chokidar's close waits on pending FDs; we now force
  `process.exit(0)` on quit so the shell returns immediately.
- **Timeline rendered in arrival order** (backfill out of order). Events
  are now binary-inserted by `ts` so the view is strictly reverse-
  chronological regardless of which file arrived first.
- **Empty-content events polluted the timeline.** Assistant messages with
  no text and no tool_use, and user turns made up only of tool_results,
  are now suppressed.

### Added
- **Project prefix on every event** — `[auraqu]`, `[_content_agent_]`,
  `[reachout]`. Claude events derive the project from the session path;
  OpenClaw tracks cwd per session from `session_start`; Cursor uses path
  heuristics. Finally makes it possible to see *where* each agent is
  working at a glance.
- **Rich Claude tool_use summaries** — Bash tool uses render as
  `Bash: <command>` with correct `shell_exec` type and risk scoring;
  Read/Write/Edit/MultiEdit render as `<Tool>: <path>`; Grep/Glob include
  the pattern; Task includes the description; WebFetch includes the URL.
- **Sticky column header** at the top of the timeline (`TIME / AGENT /
  TYPE / EVENT`).
- **Alt-screen buffer** — agentwatch now takes over the viewport on
  startup and restores the shell scrollback on exit. Standard TUI
  behaviour (lazygit / k9s / htop).

## [0.0.1] — 2026-04-14

### Added
- Claude Code adapter — tails `~/.claude/projects/**/*.jsonl` and emits
  structured `prompt`, `response`, `tool_call`, `file_read`, `file_write`,
  and `shell_exec` events.
- OpenClaw adapter — watches `~/.openclaw/agents/*/sessions/*.jsonl` across
  all sub-agents (content, research, docs, main) and surfaces session
  starts, model changes, messages, and tool calls with sub-agent
  attribution in the `tool` field. Also watches `config-audit.jsonl`
  with elevated risk scoring for config writes.
- Cursor adapter — config-level visibility over `~/.cursor/{mcp.json,
  cli-config.json, ide_state.json}` plus any project-level `.cursorrules`
  files. Emits file-read events for recently-viewed files tracked by the
  Cursor IDE.
- Workspace filesystem watcher — chokidar over `$WORKSPACE_ROOT` (default
  `~/IdeaProjects`) with sensible ignores.
- Agent detector — surfaces Claude Code, Codex, Cursor, Gemini CLI, and
  OpenClaw based on their config-directory presence.
- Permission surface viewer (Claude) — hotkey `p` opens a full-screen view
  of `~/.claude/settings.json` (+ project-level overrides), rendering the
  allow/deny lists, `defaultMode`, and flags for `Bash(*)`, missing
  `~/.ssh`/`.aws`/`.gnupg` denies, and auto/bypass modes.
- Ink TUI — live timeline with agent, event-type, and risk-score colouring;
  per-agent side panel; hotkeys `q`, `a`, `f`, `p`, `space`, `c`.
- `agentwatch doctor` — prints detected agents, config paths, and the
  workspace root.
- Risk-score heuristic — shell execs with destructive commands, writes to
  `.env` / `.ssh` / `.aws` / `.gnupg` score highest.
- Backfill — each adapter reads the last ~64 KB of a log on first
  discovery so the TUI shows immediate context.

### Notes
- Not cloud. Not an agent. Not production LLM-app tracing. Zero telemetry.
- Codex and Gemini adapters are intentionally deferred to a future release.
