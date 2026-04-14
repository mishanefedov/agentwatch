# Testing: desktop notifications

## Prerequisites

- macOS: notifications allowed for Terminal.app / iTerm / WezTerm in
  System Settings
- Linux: `notify-send` on PATH and a running notification daemon
  (dunst, notify-osd, etc.)
- Windows: PowerShell available

## Happy path (macOS example)

1. Launch TUI: `npm run dev`.
2. In another terminal, have Claude Code read a file literally named
   `.env` in one of your projects.
3. OS notification appears within ~1 second: `⚠ agentwatch — .env access`.
4. Body contains the agent name, event type, and path.
5. Wait 60 seconds.
6. Repeat the same action — notification fires again.
7. Repeat the same action twice within 60 seconds — only the first
   fires (rate limiter).

## Rules verified

- `.env` read or write.
- `~/.ssh`, `~/.aws`, `~/.gnupg` touches.
- `rm -rf`, `sudo`, `curl | sh` in shell_exec.
- Tool errors (`is_error: true`).

## Chaos tests

1. **Disable notifications at OS level.** Action still fires — we catch
   the error silently. No stderr spam.
2. **Uninstall `notify-send` on Linux** (if applicable). First call
   throws ENOENT; notifier self-disables for the session — no spam.
3. **Trigger a rule at launch time** (backfill). Must not fire — only
   events with `ts >= launchedAt` trigger notifications.
4. **Rapid-fire 10 alerts of the same kind.** Only the first fires;
   next 9 are gated out by the 60s rate-limit keyed by rule + path/cmd.

## Known limitations

- User-defined rules not supported until v0.5 (AUR-108).
- No per-agent toggling — if any agent reads `.env`, it fires.
- No "snooze for the next hour" — restart agentwatch to reset.
