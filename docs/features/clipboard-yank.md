# Yank to clipboard

## What it does

Press `y` on any selected timeline row or inside the detail pane.
Copies the most useful payload to the system clipboard. Flash message
at the footer confirms success or surfaces a reason on failure.

## How to invoke

- `y` with a row selected → copies the selected event's payload
- Confirmation: `✓ copied N chars to clipboard` (green) for 2 seconds
- Failure: `✗ <reason>` (red) for 2 seconds

## Inputs

`eventToYankText(summary, path, cmd, toolResult, fullText)` in
`src/util/clipboard.ts` picks the most useful text, in order:
1. `toolResult` — full tool output when available
2. `fullText` — prompt / response text
3. `cmd` — shell command
4. `path` — file path
5. `summary` — last-resort fallback

`copyToClipboard(text)` dispatches per platform:
- macOS: `pbcopy`
- Linux: `wl-copy` → `xclip -selection clipboard` → `xsel`
  (first-available wins)
- Windows: `clip`

Explicit `stdio: ['pipe', 'ignore', 'ignore']` on every spawnSync so
Ink's raw-mode TTY doesn't produce `EBADF` on child processes.

## Outputs

Text on the system clipboard. No disk artifacts.

## Failure modes

- **No clipboard tool available** (headless Linux without xclip / xsel /
  wl-copy). Result: `{ok: false, reason: "install wl-copy / xclip / xsel
  for clipboard support"}`. Flash shows reason.
- **Tool exits non-zero.** `{ok: false, reason: "xclip exited N"}`.
- **Nothing to yank** (empty strings everywhere). No-op, no flash.

## Interactions

- Selection state (`selectedIdx`) is required. Pressing `y` without a
  selection is a silent no-op.
- Doesn't change timeline state — pure side effect.
- Flash uses the `flash` / `flash-clear` reducer actions; a 2-second
  `setTimeout` clears.
