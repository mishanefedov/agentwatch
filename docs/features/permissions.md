# Permissions view

## Contract

**GOAL:** Side-by-side view of every agent's permission and config surface, flagging dangerous patterns.
**USER_VALUE:** Audit "what is each agent allowed to do" in one screen instead of reading five config files.
**COUNTERFACTUAL:** Permission drift goes unnoticed; a dangerous allowlist entry survives until it fires.

## What it does

Press `p` to see a scrollable view of every agent's permission /
configuration surface side-by-side. Flags dangerous patterns.

## How to invoke

- `p` opens the view
- `↑↓` / `j k` scrolls
- `p` or `esc` closes

## Inputs

Read at mount time, refreshed on every render (files are cheap to
re-read):
- **Claude**: `~/.claude/settings.json` — `permissions.allow` /
  `permissions.deny` / `defaultMode` / `additionalDirectories`. Project
  `.claude/settings.json` + `.claude/settings.local.json` also read if
  present.
- **Cursor**: `CursorStatus` object collected at startup in the cursor
  adapter — MCP servers, approval mode, sandbox, allow/deny counts,
  `.cursorrules` paths.
- **OpenClaw**: `~/.openclaw/openclaw.json` — default workspace,
  per-agent list with name/model/workspace/identity.

Gemini CLI exposes no permission model beyond auth; documented +
omitted.

## Outputs

Section-per-agent with colored titles (cyan / magenta / yellow) and:
- Metadata rows (source, defaultMode, approval mode, sandbox)
- `CAN (N)` block with green ✓ per allow rule
- `CANNOT (N)` block with red ✗ per deny rule
- Flagged risks — yellow warnings or red errors:
  - `Bash(*)` allow → arbitrary shell
  - Write/Edit allowed with no `~/.ssh`/`.aws`/`.gnupg` deny
  - Empty deny list
  - `defaultMode=auto` or `bypassPermissions`

Footer pagination `N–M of total  ↑↓ scroll  [p] close  [q] quit`.

## Failure modes

- **settings.json missing.** Shows "No settings.json found."
- **settings.json malformed.** Try/catch around JSON.parse; section
  shows placeholder.
- **OpenClaw not installed.** Section shows "not detected".
- **Cursor not installed.** Same.

## Interactions

- Independent of timeline — opening permissions doesn't change filters.
- Flags produce a visual cue only; no events are emitted. (Live flag
  detection → notifications is AUR-108 regex triggers.)
