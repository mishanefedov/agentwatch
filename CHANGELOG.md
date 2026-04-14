# Changelog

All notable changes to agentwatch are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

**What counts as breaking?** CLI flags, the `agentwatch doctor` output contract,
and the canonical event schema (`src/schema.ts`). Adapter internals and TUI
layout can change freely within a minor version.

## [Unreleased]

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
