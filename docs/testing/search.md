# Testing: search

## Happy path

1. `/` opens search — yellow `/` prompt appears under the timeline with a
   blinking cursor.
2. Type `Bash` — every keystroke narrows the timeline.
3. Below the timeline: `matches: N` shows live count.
4. Backspace — cursor edits query, matches widen.
5. `Enter` — input mode exits, cursor disappears, query persists as
   sticky filter. Breadcrumb shows `search "Bash"`.
6. Type `/` again + new query — replaces previous.
7. `esc` clears query and exits mode.

## Chaos tests

1. **Type `q` while in search mode.** Must stay in search (not quit).
2. **Regex-special characters (`.` `*` `[`) in query.** Treated as
   literals — no regex matching.
3. **Empty query after backspacing all chars.** Filter effectively
   disabled; all events visible.
4. **Query that matches nothing.** Timeline shows empty body,
   `matches: 0` visible.
5. **Query across 10k+ events.** Still instant (in-memory).
6. **Navigate with ↑↓ while search open.** Should stay in search input
   mode — ↑↓ not consumed by timeline.

## Known limitations

- No regex support in v0 (planned v0.5 via custom triggers).
- No highlighting of matched substring within rows (only whole-row
  filtering).
- In-buffer only. Cross-session disk search is AUR-111, v0.5.
