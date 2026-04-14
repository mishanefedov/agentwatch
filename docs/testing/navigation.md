# Testing: projects + sessions navigation

## Prerequisites

- ≥3 projects with ≥1 session each in your event buffer (if you're new
  to agentwatch, use Claude Code in a few directories first to
  populate).

## Happy path

1. `P` opens projects grid.
2. Header reads `Projects — N workspaces`.
3. Footer: `[↑↓] select project · [enter] sessions · [esc] close`.
4. `↓↓↓` — selected row marker moves.
5. Each card shows: name (padded), ago-string, cost (yellow), events
   count, sessions count, per-agent breakdown `claude:22, openclaw:4`.
6. `Enter` on a project — Sessions view opens.
7. Sessions view header: `Sessions — <project>  N sessions`.
8. Rows bucketed by heading: `TODAY`, `YESTERDAY`, `LAST 7 DAYS`,
   `OLDER`.
9. Each session row: colored agent tag, first user prompt, event count,
   ago, cost, `· ERR` suffix if any error.
10. `Enter` on a session — main timeline scopes to that session's
    events only. Breadcrumb shows `session <id8>`.
11. `esc` from scoped timeline — returns to fresh timeline, scope
    cleared.
12. `Z` from anywhere clears all filters (project, session, subagent,
    agent, search).
13. `0` from anywhere — home reset (same as Z + close all modals).

## Chaos tests

1. **Zero projects** (new machine, no session history). Grid shows
   "No projects yet. Use Claude Code / OpenClaw / Cursor and they'll
   show up here as events stream in."
2. **Project with 200 sessions.** Sessions view scrolls; pagination
   shows `N–M of total`.
3. **Session with no user prompt** (subagent-only activity). First-
   prompt field shows "(no user prompt yet)".
4. **esc from sessions view.** Must return to projects grid, not jump
   all the way out.
5. **Change agent filter while inside a scoped session.** Scope
   persists; agent filter stacks on top.

## Known limitations

- Search `/` inside the projects view narrows projects by name. Same
  `/` in sessions view narrows by prompt text.
- "Scoped timeline" doesn't persist across agentwatch restarts — no
  bookmarks yet.
