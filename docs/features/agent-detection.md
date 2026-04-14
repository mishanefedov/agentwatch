# Agent detection

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
| Cursor | `~/.cursor/` | ✓ (config-level) |
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
