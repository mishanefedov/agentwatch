# agentwatch

**Local-only observability for AI coding agents.** One terminal timeline across Claude Code, Cursor, and OpenClaw — what each agent is reading, writing, running, and what each is actually allowed to do.

No cloud. No Docker. No telemetry. `npm i -g agentwatch` and go.

## Why

You're running Claude Code + Cursor + OpenClaw on the same machine. Each has its own config (`CLAUDE.md`, `.cursorrules`, OpenClaw workspaces), its own activity log in a different place, and its own permission model. Nothing shows you one unified view: *right now, which agent just touched which file, ran which command, and why.*

[claude-devtools](https://github.com/matt1398/claude-devtools) solves this beautifully — for Claude only. agentwatch does the same thing for the whole multi-agent setup.

## Install

```bash
npm i -g @misha_misha/agentwatch
agentwatch
```

That's it. No config, no accounts, no daemon. (Published under a
scope because `agentwatch` was blocked by npm's anti-typosquatting
check — the binary is still `agentwatch`.)

Requires Node ≥ 20. Works on macOS and Linux.

## What it shows

- **Claude Code** — tails `~/.claude/projects/**/*.jsonl` and emits every prompt, response, tool call, file read/write, and shell exec with attribution and risk scoring.
- **OpenClaw** — watches `~/.openclaw/agents/*/sessions/*.jsonl` across every sub-agent (content, research, docs, main) with sub-agent attribution in the event stream, plus `config-audit.jsonl` with elevated risk scoring for config writes.
- **Cursor** — config-level visibility: MCP server list, permissions (`cli-config.json`), recently-viewed files (`ide_state.json`), discovered `.cursorrules` anywhere in your workspace.
- **Workspace filesystem** — chokidar-backed watcher over `$WORKSPACE_ROOT` (default `~/IdeaProjects`) with sensible ignores (`node_modules`, `.git`, `dist`).
- **Permissions (Claude)** — press `p` in the TUI to open a full-screen view of `~/.claude/settings.json`. Renders the allow / deny lists, `defaultMode`, and flags dangerous patterns: `Bash(*)`, missing `~/.ssh`/`.aws`/`.gnupg` denies, auto/bypass modes.

## Hotkeys

```
q       quit
a       toggle agent side panel
f       cycle agent filter
p       toggle full-screen permission view
space   pause / resume event stream
c       clear events
```

## CLI

```
agentwatch         launch the TUI
agentwatch doctor  detect installed agents and print config paths
agentwatch --help  usage
```

`$WORKSPACE_ROOT` overrides the detected workspace root.

## How it compares

| | agentwatch | claude-devtools | Unfucked | Langfuse / Phoenix |
|---|---|---|---|---|
| Runs locally only | ✓ | ✓ | ✓ | self-host possible |
| Multi-agent | ✓ Claude + Cursor + OpenClaw | Claude only | agent-agnostic (file-level) | production apps, not CLI agents |
| Per-agent attribution | ✓ | ✓ | ✗ (file-level only) | N/A |
| Permission surface view | ✓ | ✗ | ✗ | ✗ |
| Install | `npm i -g` | Homebrew / Electron app | Homebrew / Rust binary | Docker + Postgres |

## Non-goals

- Not cloud. Not a SaaS. Not ever.
- Not an agent itself.
- Not production LLM-app tracing — [Langfuse](https://langfuse.com) owns that space.
- Not enterprise compliance — Anthropic's Compliance API covers that.
- Not orchestration. Use [Mission Control](https://github.com/MeisnerDan/mission-control) or [DevSwarm](https://devswarm.ai) for running agents in parallel.

## Roadmap

- Codex + Gemini CLI adapters
- Deeper Cursor activity (SQLite AI-tracking DB)
- MCP proxy mode (`agentwatch wrap <agent>`)
- Permission viewer for OpenClaw + Cursor + Codex + Gemini

Feature requests → [GitHub issues](https://github.com/mishanefedov/agentwatch/issues).

## Development

```bash
git clone https://github.com/mishanefedov/agentwatch.git
cd agentwatch
npm install
npm run dev
```

Run tests with `npm test`. Typecheck with `npm run typecheck`.

## License

MIT © Misha Nefedov. See [LICENSE](./LICENSE).
