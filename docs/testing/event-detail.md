# Testing: event detail pane

## Prerequisites

- ≥1 assistant-turn event in the timeline (prompt or response)
- ≥1 tool_use event (preferably a Bash or Edit)

## Happy path

1. `↑↓` to select an event.
2. `Enter` to open detail.
3. Verify header line: time + agent + type + tool (if applicable).
4. For an assistant-turn event, verify "tokens / cost / duration" block
   shows: `in=N cache_create=N cache_read=N out=N`, `cost: $X.XX
   (claude-opus-4-6)`, and `duration: Nms` if paired with a tool_result.
5. For a prompt event, verify "text" heading + full prompt text wrapped
   to terminal width.
6. For a tool_use event, verify "tool input" heading with JSON-pretty
   arguments; and "tool result" heading with the flattened output.
7. Scroll with `↓↓↓` — pagination footer updates.
8. `esc` closes — returns to the same timeline view with the same
   selection.

## Chaos tests

1. **Event with no details.** Select a `session_start` event or any
   row where we didn't attach `details`. Detail pane shows "(no
   additional content captured for this event)".
2. **Very long tool_result.** Select a Bash run that produced >256 KB
   of stdout (e.g. a `cat` on a big file). Content is truncated with
   `… [N bytes truncated]` at the end.
3. **Resize terminal while detail open.** The `viewportRows` / `cols`
   recompute on every render; scroll offset clamps to the new max.
4. **Binary-content tool_result.** If stdout contained bytes that break
   Unicode, verify we still render (may show replacement chars) and
   don't crash.

## Known limitations

- No syntax highlighting yet (tracked as AUR-105, M5).
- No inline diff rendering for Edit tool_use — file content shown as
  plain text. Diff view is tracked for v0.4.
