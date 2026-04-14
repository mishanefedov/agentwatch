# Testing: clipboard yank

## Prerequisites

- macOS: `pbcopy` (always installed)
- Linux: `wl-copy` OR `xclip` OR `xsel` — first-found wins
- Windows: `clip` (always installed)

## Happy path

1. Select any event with a `toolResult` (a Bash row works — select,
   press `Enter` first to see its content, then `esc` back).
2. Press `y`.
3. Flash message `✓ copied N chars to clipboard` appears for 2s.
4. Paste in another app — content matches the event's tool_result.

Per-event priority (`eventToYankText`):
- tool_result text if present
- else fullText
- else cmd
- else path
- else summary

## Chaos tests

1. **No clipboard tool installed (Linux minimal).** Flash shows
   `✗ install wl-copy / xclip / xsel for clipboard support`.
2. **Yank on a `session_start` event.** Copies the cwd path (summary)
   or placeholder.
3. **Yank a 256 KB tool_result** (our cap). Clipboard receives the full
   truncated string (with `[N bytes truncated]` suffix).
4. **Press `y` with no selection.** Silent no-op — no flash, no
   clipboard change.
5. **Spam `y` rapidly.** Every press copies + shows flash; 2s timers
   just overlap.

## Known limitations

- Macro-recording-style "yank multiple events" not supported. Visual
  selection of ranges isn't modeled yet.
