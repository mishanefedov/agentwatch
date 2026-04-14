# Timeline

## What it does

The main view. Every event emitted by any installed agent streams into a
reverse-chronological list. Each row: timestamp · agent · event type ·
`[project / sub-agent]` summary · duration · error flag.

## When it fires / how to invoke

Opened by default when you run `agentwatch`. Filters stack: agent filter
(`f`), project filter (selected via `P`), session scope (via sessions
list), subagent scope (`x` on an Agent tool_use event), search (`/`).

## Inputs

- Live reads from adapters: Claude Code, OpenClaw, Cursor (config),
  Gemini CLI.
- Event buffer capped at `MAX_EVENTS = 500`. Older events fall off the
  tail.
- Each event carries its canonical `ts` (ISO) — sort order is strictly
  reverse-chronological by `ts`, not by arrival order.

## Outputs

- Ink-rendered TUI rows, one per event
- Columns sized to terminal width; content truncated with ellipsis rather
  than wrapping (so every event is exactly one line)
- Risk-based coloring: green (file_read) / white (tool_call) / orange
  (file_write) / red (shell_exec with destructive pattern)
- When selection is active (`↑↓`), selected row is inverse-highlighted

## Failure modes

- **Backfill arrives out of order.** Resolved via binary-insert by `ts` on
  every incoming event.
- **Incoming event has `ts` in the future.** Clamped to now+60s by
  `clampTs()` in `src/schema.ts`.
- **Terminal too narrow (<60 cols) or short (<12 rows).** App renders a
  "terminal too small" screen instead of the broken layout.
- **500+ events in buffer.** Oldest drop off. For deeper history, drill
  via projects → sessions (AUR-119/120/121).

## Interactions

- `Enter` opens [event detail](./event-detail.md) for the focused row.
- `/` opens [search](./search.md).
- `P` opens [projects navigation](./projects-nav.md).
- `p` opens [permissions](./permissions.md).
- `x` enters [subagent drilldown](./subagent-drilldown.md).
- `y` copies the row's most useful payload to the clipboard
  (see [clipboard-yank](./clipboard-yank.md)).
- `space` pauses the live stream without clearing the buffer.
