# agentwatch

**Local-only observability for AI coding agents.** See what Claude Code, Codex, Cursor, Gemini, and OpenClaw are touching on your machine — in one timeline.

No cloud. No Docker. No telemetry. `npm i -g agentwatch` and go.

## Why

You run 3+ AI coding agents. Each has its own config (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, OpenClaw's `MEMORY.md`), its own activity log, its own permission model. Nothing shows you in one view: *right now, which agent just touched which file, ran which command, and why.*

## Install

```bash
npm i -g agentwatch
agentwatch
```

That's it.

## What it does (v0.0.1)

- Tails `~/.claude/projects/**/*.jsonl` and surfaces every tool call, file read/write, shell exec, prompt
- Watches your workspace (`~/IdeaProjects` by default) for file changes
- Unified timeline view in a TUI
- Zero config. Zero infra. Zero telemetry.

## What it doesn't do (yet)

- Codex / Cursor / Gemini / OpenClaw adapters (coming in v0.1)
- Permission surface diffing
- MCP call interception via proxy mode
- Cloud / team features (not in scope — ever)

## Development

```bash
pnpm install
pnpm dev
```

## License

MIT
