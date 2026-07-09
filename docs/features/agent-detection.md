# Agent detection

## Contract

**GOAL:** Surface which AI coding agents are installed and whether agentwatch instruments each one.
**USER_VALUE:** Answer "why am I not seeing events from <agent>?" in one glance, without a support thread.
**COUNTERFACTUAL:** Silent miss-detection — a user thinks agentwatch covers their Codex runs while it isn't emitting.

## What it does

Surfaces which AI coding agents are installed on this machine, and
whether agentwatch is actually instrumenting each one (emits events)
or just recognizing it.

## How to invoke

- `agentwatch doctor` from the shell — prints the full table
- Inside the TUI: `a` toggles the right-hand agent panel

## Inputs

`detectAgents()` in `src/adapters/detect.ts` checks known paths:

| Agent | Detection path | Instrumented |
|---|---|---|
| Claude Code | `~/.claude/projects/` | ✓ |
| OpenClaw | `~/.openclaw/` | ✓ |
| Cursor | `~/.cursor/` or a `workspaceStorage/*/state.vscdb` with activity | ✓ |
| Gemini CLI | `~/.gemini/` | ✓ |
| Codex | `~/.codex/` | not yet |
| Aider | `~/.aider.chat.history.md` or `~/.aider.input.history` | not yet |
| Cline (VS Code) | `Code/User/globalStorage/saoudrizwan.claude-dev/` | not yet |
| Continue.dev | `~/.continue/` | not yet |
| Windsurf | `~/.codeium/` | not yet |
| Goose (Block) | `~/.config/goose/` | not yet |

## Outputs

`DetectedAgent[]` with `{name, label, configPath?, present, instrumented}`.

Doctor output:
```
● Claude Code        installed (events captured)
● Cursor             installed (events captured)
○ Codex              not detected
● Windsurf           detected (events not yet captured — help us ship this)
```

When any detected-but-not-instrumented agent is present, doctor appends:
```
Agents detected but not yet instrumented:
  - Windsurf
If you want events captured for these, open an issue with a redacted
session file: https://github.com/mishanefedov/agentwatch/issues/new
```

Agent side panel inside the TUI applies the same `●` (green) /
`●` (yellow) / `○` (gray) color code.

## Cursor: what's captured vs. what isn't

`src/adapters/cursor.ts` reads two independent surfaces, both read-only:

- **Config** (`~/.cursor/mcp.json`, `cli-config.json`, `ide_state.json`,
  `.cursorrules` / `.cursor/rules/*.mdc`) — watched for changes only.
- **Activity** — every `workspaceStorage/*/state.vscdb` under
  `~/Library/Application Support/Cursor/User/` (macOS) or
  `~/.config/Cursor/User/` (Linux). Each is a VS Code-style
  `ItemTable(key, value)` SQLite db. We read two keys:
  - `composer.composerData` → one `session_start` event per composer
    session, timestamped at its `createdAt`, with `totalLinesAdded` /
    `totalLinesRemoved` carried in `details.linesChanged`.
  - `aiService.prompts` → one `prompt` event per entry, anchored to the
    most-recently-created composer's `createdAt` in that db (there is no
    per-prompt timestamp and no stored link from a prompt to a
    composerId, so this is a rough-but-real approximation, not exact).

  These two config surfaces are independent: a Cursor GUI user with no
  `~/.cursor` directory (never used the CLI) still gets activity events
  as long as a `state.vscdb` with a composer session exists.

- **What's permanently absent**: tool_call/tool_result, per-turn token
  usage, and cost. Cursor doesn't write any of that to disk — it isn't a
  parsing gap, there is nothing on disk to parse. Don't expect Cursor
  sessions to show token/cost numbers the way Claude Code or Codex do.

## Failure modes

- **Cline macOS vs Linux path mismatch**: handled via `os.platform()`
  branch. Windows is `os.platform() === 'win32'` which currently falls
  through to the Linux path (incorrect for Windows, but Windows isn't
  supported in v0).
- **Home dir not readable**: `existsSync` returns false safely.
- **Symlinked `~/.claude`**: `existsSync` follows symlinks.

## Interactions

- TUI agent panel updates live based on detection + event counts.
- When no instrumented agents are installed, the timeline shows
  "waiting for activity…" — no events will ever arrive.
