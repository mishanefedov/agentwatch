# Projects navigation

## What it does

Press `P` to open a projects grid aggregating every workspace path across
every installed agent. Pick one → drill into its sessions list (see
[sessions-nav](./sessions-nav.md)).

## How to invoke

- `P` (uppercase) opens the grid
- `↑↓` / `j k` to move selection
- `Enter` opens the sessions list for the selected project
- `esc` closes

## Inputs

Derived from the event buffer via `buildProjectIndex()` in
`src/util/project-index.ts`:
- **Project name** = first-bracketed tag of each event's summary
  (`[auraqu]`, `[_content_agent_]`). Claude derives from session-file
  path; OpenClaw from `cwd` captured at `session_start`; Cursor from
  a path heuristic; Gemini from `~/.gemini/tmp/<dir>/chats/`.
- **Per-agent counts** from `byAgent` map
- **Cost** summed across `event.details.cost`
- **Last activity** = max `ts` of any event in the project
- **Session count** = size of the `sessions` set (unique sessionIds)

## Outputs

Rows sorted descending by last activity. Each row shows:
- Name (26 chars)
- Time-ago (5m ago / 2h ago / 3d ago)
- Cost (yellow)
- Sub-line: event count · session count · per-agent breakdown

## Failure modes

- **Event summary lacks a bracket tag.** Event is excluded from the index
  (fs-watcher events for un-attributed file changes fall in this bucket).
- **Rapid project switching** (>100 projects). Rendering stays cheap; the
  index is O(n) and builds on every render via a plain for-loop.

## Interactions

- Enter → sessions list scoped to that project.
- After returning to the timeline, the project scope persists as a
  yellow breadcrumb. `Z` clears it; `0` resets everything.
