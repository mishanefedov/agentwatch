# Search

## What it does

In-buffer full-text filter. Press `/`, type a query, the timeline narrows
to matches.

## How to invoke

- `/` opens the input line
- Type — timeline updates live
- `Backspace` edits
- `Enter` exits input mode but **keeps** the query as a sticky filter
- `esc` clears the query and exits
- While the query is active, a breadcrumb shows `search "<query>"`

## Inputs

`matchesQuery(event, query)` in `src/ui/App.tsx`:
- Case-insensitive substring search
- Checks: summary, path, cmd, tool, agent, `details.fullText`,
  `details.thinking`

## Outputs

- Filtered timeline
- Match count shown below the timeline (`matches: 45`)
- Yellow blinking cursor `▌` while in input mode
- Breadcrumb integrates with other active scopes

## Failure modes

- **Empty query.** No filter applied.
- **Regex-special characters in query.** Treated as literals — we do
  substring, not regex. Regex/glob support is tracked for v0.5
  (AUR-108 custom triggers).
- **Huge result set.** The timeline window caps at 40 rendered rows
  regardless.

## Interactions

- Stacks with agent filter + project filter + session filter + subagent
  scope. All filters are AND'd.
- Cross-session disk search (ripgrep over all jsonl files) is a separate
  v0.5 feature (AUR-111).
