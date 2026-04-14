# Use case: "Wait, did the agent just read my .env?"

**Scenario.** You're running Claude Code, focused on something unrelated.
A notification appears:

```
⚠ agentwatch — .env access
claude-code file_read /Users/you/IdeaProjects/prod-deployer/.env
```

## With agentwatch

1. Notification fires within ~1 second of Claude reading the file.
   Rate-limited so a legitimate multi-step task only fires once.
2. Open the agentwatch TUI (or focus the one you already had running).
3. `/` → type `.env` → scoped to the events touching `.env` files.
4. `Enter` on the `file_read` → detail pane:
   - What prompt led to it (walk back in the same session)
   - What the tool_result (file content) was — now in Claude's context
5. Decide:
   - If innocent (agent read it to parse env vars for a legitimate
     task) → OK
   - If surprising (agent shouldn't have, or you didn't ask for this)
     → rotate any sensitive secrets immediately and dig into the
     session for more

## Why agentwatch flags this

Hardcoded rule in `src/util/notifier.ts`:
- Path matches `(^|/)\.env($|\.)` → notify
- Key: the full path (so re-reads of the same `.env` within 60s are
  rate-limited but a second `.env` in a different project still fires)

Additional paths flagged the same way:
- `~/.ssh`, `~/.aws`, `~/.gnupg`

## Caveats

- Doesn't *block* the read. agentwatch is read-only; see
  [DashClaw](https://github.com/ucsandman/DashClaw) /
  [Castra](https://github.com/amangsingh/castra) for pre-execution
  policy enforcement.
- Rules are hardcoded in v0.3. User-defined regex triggers ship in
  v0.5 (AUR-108).
