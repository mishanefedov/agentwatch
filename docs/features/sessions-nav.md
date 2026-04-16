# Sessions navigation

## Contract

**GOAL:** Date-bucketed list of every session for one project, across every agent; Enter scopes the timeline.
**USER_VALUE:** Review yesterday's Claude session and today's Codex session for the same repo in seconds.
**COUNTERFACTUAL:** Users manually match timestamps across five JSONL dirs to reconstruct a session.

## What it does

After picking a project, shows every session for that project across
every agent, bucketed by date (Today / Yesterday / Last 7 days / Older).
Pick a session → scope the timeline to only its events.

## How to invoke

- From the projects grid, `Enter` on a project
- `↑↓` / `j k` to move through session rows (buckets are skipped)
- `Enter` scopes the main timeline to that session
- `esc` returns to projects

## Inputs

`buildSessionRows(events, project)` in `src/util/project-index.ts`:
- Groups `events` by `sessionId` where the event's `project` equals the
  selected project
- For each session: records the first user prompt text, event count,
  first/last timestamp, total cost, and whether any event had
  `toolError: true`
- Rows sorted descending by `lastTs`
- Date bucket computed by `dateBucket(lastTs)`:
  `today` | `yesterday` | `7d` | `older`

## Outputs

Each row:
- Yellow selection marker
- Colored agent tag (cyan=claude-code, yellow=openclaw, magenta=cursor,
  blue=gemini, green=codex)
- First user prompt truncated to 56 chars (falls back to "(no user
  prompt yet)")
- Event count + time-ago + cost (yellow)
- Red `· ERR` suffix if any event errored

## Failure modes

- **Session with no user prompt.** Shows placeholder string.
- **Session with only a session_start + no messages.** Rendered with
  event count 1 and placeholder prompt.
- **Large project (>500 sessions).** All render; scroll works fine.

## Interactions

- Enter on a session → sessionFilter applied to timeline (scoped view).
  Breadcrumb shows `session <id8>`.
- `Z` clears session filter. `0` clears everything.
- Detail pane (`Enter`), search (`/`), yank (`y`) all work inside a
  scoped session.
