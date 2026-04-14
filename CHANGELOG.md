# Changelog

All notable changes to agentwatch are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

**What counts as breaking?** CLI flags, the `agentwatch doctor` output contract,
and the canonical event schema (`src/schema.ts`). Adapter internals and TUI
layout can change freely within a minor version.

## [Unreleased]

## [0.0.2] — 2026-04-14

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
