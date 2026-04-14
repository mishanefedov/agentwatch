# 15-minute pre-release test script

Run before every tagged release. Walks through every feature once with
a real machine + real agent activity.

## Prerequisites

- Node ≥ 20
- At least one AI coding agent installed (Claude Code preferred)
- A workspace with ≥3 projects under `~/IdeaProjects` (or whatever
  `$WORKSPACE_ROOT` is set to)
- Clean clone of `agentwatch` + `npm install`
- Terminal ≥ 100 cols × 30 rows recommended

## Steps

### 1. `agentwatch doctor` (30s)

```bash
npx tsx src/index.tsx doctor
```

**Expect:**
- Every installed agent shown with `●` + "installed (events captured)"
- Non-installed agents show `○` + "not detected"
- Detected-but-not-instrumented agents show `●` + yellow "detected
  (events not yet captured — help us ship this)"
- Workspace path printed at top
- If any non-instrumented agents are present, the footer help-banner
  appears with an issue link

**Red flag:** a crash, a permission error, or any agent misclassified
(e.g. "installed" but not actually present).

### 2. Launch TUI, observe backfill (1 min)

```bash
npm run dev
```

**Expect:**
- Alt screen enters cleanly (previous terminal content hidden)
- Column header visible: `TIME · AGENT · TYPE · EVENT`
- Backfill events appear within ~2 seconds, ordered newest first
- Timeline shows ≤40 rows with proper risk coloring
- Right-side agent panel lists every detected agent with event counts +
  cost

**Red flag:** empty timeline after 5s if you have any session history;
events appearing in random order; panel showing wrong counts.

### 3. Event detail pane (1 min)

- `↓` once to select the top event
- `Enter` to open detail
- Scroll `↓↓↓` through the content
- Verify: tokens/cost/duration block, full text, tool input JSON,
  tool result (if applicable), extended thinking (if applicable)
- `esc` to close

**Red flag:** missing content for an event that should have it;
scroll not working; escape not closing.

### 4. Full-text search (1 min)

- `/` to open search
- Type `Bash` (or any common token)
- Verify: match count drops below total; filtered rows all contain the
  token
- Backspace to edit the query
- `Enter` to confirm (breadcrumb shows `search "bash"`, input cursor gone)
- Type `/` again + new query — query replaces the old one
- `esc` clears

**Red flag:** typing `q` while in search mode quitting the app (bug we
fixed in `confirm-search`); match count wrong; esc not clearing.

### 5. Projects navigation (2 min)

- `P` opens projects grid
- `↓↓↓` to move selection
- `Enter` on a project with multiple sessions
- Sessions list appears, bucketed by date
- `↓↓↓` to move
- `Enter` on a session
- Timeline is now scoped to that session (breadcrumb shows session
  id8); only session events visible
- `esc` back to projects list
- `esc` back to main timeline
- `0` home — everything reset

**Red flag:** selection jumping around unexpectedly; esc not walking
back one level; sessions list showing wrong agent tags.

### 6. Subagent drilldown (1 min)

- Look for a row with `▸ N child events` suffix (Claude Agent tool_use)
- Select it, press `x`
- Breadcrumb shows `sub <agentId8>`
- Timeline shows only that subagent's inner tool calls
- `X` to unscope

**Red flag:** `x` silently doing nothing on a row that clearly has a
subAgentId (regex failure); wrong events appearing in the scoped view.

### 7. Permissions view (1 min)

- `p` opens the view
- Scroll `↓↓↓` through Claude section, Cursor section, OpenClaw section
- Verify flagged risks appear in red/yellow
- Pagination footer shows `N–M of total`
- `p` or `esc` closes

**Red flag:** view too long to scroll; sections missing; flag labels
wrong.

### 8. Clipboard yank (30s)

- Select any event with a `cmd` or `toolResult`
- `y`
- Flash `✓ copied N chars to clipboard` appears briefly
- Paste in another app to verify content

**Red flag:** `✗ EBADF` (stdio regression); wrong content pasted; no
flash at all.

### 9. Desktop notifications (2 min)

- In another terminal, run `echo foo > /tmp/test.env && rm /tmp/test.env`
  (does NOT fire; path isn't `.env`)
- Actually trigger: use Claude Code, have it read a file literally named
  `.env` in one of your projects
- Verify OS notification appears with `⚠ agentwatch — .env access`
- Wait 60s, trigger same action again — notification fires again
- Trigger the same action twice within 60s — second is rate-limited

**Red flag:** notification fires on every backfill event (regression
on launchedAt gating); rate limit not working; `osascript` throwing
visible errors.

### 10. Terminal-too-small (30s)

- Resize terminal to <60 cols or <12 rows
- Verify the "terminal too small" screen appears with current dimensions
- Resize back — TUI returns (after brief re-mount)

**Red flag:** broken layout instead of the friendly message.

### 11. Help overlay (15s)

- `?` opens the help overlay
- Every hotkey group visible
- `?` or `esc` closes

**Red flag:** missing hotkeys; `esc` not closing.

### 12. Graceful quit (10s)

- `q` quits instantly
- Terminal scrollback restored (alt screen exits cleanly)
- Shell prompt returns

**Red flag:** 2+ second delay on quit (chokidar close regression);
terminal stuck in raw mode; scrollback corrupted.

## Sign-off

If all 12 steps pass with zero red flags → proceed to tag + publish.

If any red flag → file a Linear issue, block the release, fix + re-run
this script end-to-end.

## Artifacts to keep per release

- Screenshot of each view as of this release (for regression
  comparison on the next release)
- `agentwatch doctor` output
- `npm pack --dry-run` output
