# Testing: permissions view

## Prerequisites

- Claude Code installed with a populated `~/.claude/settings.json`
- Ideally OpenClaw installed to test that section
- Ideally Cursor installed to test that section

## Happy path

1. `p` opens the permissions view.
2. Verify header: `Permissions / Configuration across installed agents`.
3. Claude section (cyan title) shows:
   - `source: /Users/…/.claude/settings.json`
   - `defaultMode:` with color (red if `auto`/`bypassPermissions`)
   - `CAN (N)` block with ✓-prefixed rows
   - `CANNOT (N)` block with ✗-prefixed rows
4. If `Bash(*)` is in allow, verify yellow `⚠ Flags` section with red
   `✗ Bash(*) allows arbitrary shell…` line.
5. Cursor section (magenta) shows MCP server list + approval mode +
   sandbox.
6. OpenClaw section (yellow) shows default workspace + each sub-agent
   with model + workspace.
7. Pagination footer shows `N–M of total`. `↓↓↓` scrolls; `↑↑↑` scrolls
   back.
8. `p` or `esc` closes → returns to the previous view.

## Chaos tests

1. **Malformed settings.json.** Temporarily write `{` to the file.
   Permissions view should show "No settings.json found." or a
   source-line with the path but empty allow/deny (never a crash).
2. **No settings.json.** Move the file aside. Section shows "No
   settings.json found.".
3. **OpenClaw / Cursor not installed.** Those sections show "not
   detected".
4. **Terminal < 20 rows.** Scroll works — entire view shown via
   pagination.
5. **Very long deny list (100+ entries).** Scroll should remain smooth;
   pagination accurate.

## Known limitations

- Gemini CLI section intentionally omitted (Gemini exposes no
  permission model beyond auth).
- Codex / Aider / Cline permissions not yet shown — comes when those
  adapters ship.
- No "what if I change this" simulator. View is read-only.
