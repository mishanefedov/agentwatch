# Security Policy

agentwatch is a local observability tool. It reads files from your home
directory (Claude Code logs, OpenClaw workspaces, Cursor config, workspace
filesystem). It never sends data over the network.

If you find a vulnerability, please report it privately before opening a
public issue.

## Reporting

- **Email:** `misha@auraqu.com`
- **GitHub:** open a [Security Advisory](https://github.com/mishanefedov/agentwatch/security/advisories/new) (private)

Please include:

- Version affected (output of `agentwatch --version` or package version)
- OS + Node version
- Minimal reproduction steps
- Observed impact

I'll respond within 7 days.

## Scope

**In scope:**

- Arbitrary file read outside the documented watched paths
- Exfiltration of file contents or metadata to the network
- Command injection through watched file names or log contents
- Prototype pollution or similar JavaScript-ecosystem vulns in the parser
- Denial of service against the running TUI from crafted log lines
- Supply-chain issues in the npm package

**Out of scope:**

- Social-engineering the maintainer
- Bugs in Claude Code / Cursor / OpenClaw themselves
- Vulnerabilities in the terminal emulator, OS clipboard tools, notification
  daemons, or other OS-provided infrastructure agentwatch shells out to

## What agentwatch reads

Full list documented in the README, but for quick reference:

- `~/.claude/projects/**/*.jsonl` (Claude Code session transcripts + subagents)
- `~/.claude/settings.json` (Claude permissions)
- `~/.openclaw/agents/*/sessions/*.jsonl` (OpenClaw sub-agent sessions)
- `~/.openclaw/logs/config-audit.jsonl` (OpenClaw config audit trail)
- `~/.openclaw/openclaw.json` (OpenClaw agent roster)
- `~/.cursor/mcp.json`, `cli-config.json`, `ide_state.json` (Cursor state)
- Project-level `.cursorrules` files under `$WORKSPACE_ROOT`
- The `$WORKSPACE_ROOT` tree (defaults to `~/IdeaProjects`) for file-change
  events

agentwatch **writes** only to the terminal and to the system clipboard (on
explicit `y` key press). No files are created or modified outside of its own
repo during development.

## What agentwatch does NOT do

- No outbound HTTP / DNS / network calls (verify with `lsof -i -p $(pgrep -n agentwatch)`)
- No telemetry. Not opt-in, not opt-out — it's just absent.
- No account, no cloud, no sign-in.
- No data leaves your machine.
