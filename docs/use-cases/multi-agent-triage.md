# Use case: Who touched this project today?

**Scenario.** You're running Claude Code, Cursor, and OpenClaw on the
`auraqu` monorepo. Tests are failing. You want to know: which agent
wrote which file, in what order, over the last few hours.

## With agentwatch

1. Launch: `agentwatch`
2. `P` → projects grid
3. Select `auraqu`, `Enter`
4. Sessions list for auraqu, bucketed by date
5. Glance at today's bucket — multiple sessions tagged
   `[claude-code]`, `[openclaw:content]`, `[cursor]`
6. `↓` to the session whose first prompt hints at the failure you're
   debugging
7. `Enter` — timeline scopes to just that session
8. `/` → type `src/auth` — filtered to events touching that path
9. `Enter` on a `file_write` row → full diff
10. `y` to yank the diff into your PR description

## Without agentwatch

Open three terminals. `tail -f ~/.claude/projects/<escaped>/<session>.jsonl`,
`tail -f ~/.openclaw/agents/content/sessions/<id>.jsonl`, `grep` Cursor's
SQLite… `jq` through JSONL to find timestamps ~90 minutes ago…
cross-reference `git log --since` output… give up and just `git bisect`.

## What the TUI shows

- Breadcrumb at top: `agentwatch · auraqu · session ab3c99 · search "src/auth"`
- Footer hint: `[?] help  [esc] back  [y] yank  [p] permissions`
- Per-session cost in the sessions list: `$0.14 · 12 events · 3m ago`

## Keys used

`P`, `↓`, `Enter`, `/`, `Enter`, `y`, `esc`.
