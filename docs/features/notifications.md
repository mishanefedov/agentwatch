# Desktop notifications

## What it does

Fires OS-native notifications on sensitive events. Rate-limited so a
looping agent doesn't spam alerts. Silent during backfill so launching
agentwatch doesn't dump historical alerts.

## How to invoke

Automatic. Dispatched from `src/util/notifier.ts`. Built-in rules are
hardcoded; on top of those the user can add their own triggers in
`~/.agentwatch/triggers.json` (see **Custom triggers** below).

## Inputs

Every new event passes through `shouldNotify(event)`:

- **`.env` access** — `file_read` or `file_write` on a path matching
  `(^|/)\.env($|\.)`. Keyed by path.
- **Credential paths** — any path matching
  `(^|/)(\.ssh|\.aws|\.gnupg)($|/)`. Keyed by path.
- **Destructive shell** — `shell_exec` with `\brm\s+-rf\b`, `\bsudo\b`,
  or `curl[^|]*\|\s*(sh|bash)`. Keyed by command prefix.
- **Tool errors** — `details.toolError === true`. Keyed by tool + session.
- Events whose `ts` is before `launchedAt` are silently skipped
  (backfill).

## Outputs

`notify(title, body)` in `notifier.ts` dispatches:
- macOS: `osascript -e 'display notification …'`
- Linux: `notify-send <title> <body>`
- Windows: PowerShell `MessageBox` fallback

Rate limiter (`gate(key)`): one alert per rule-key per 60 seconds.

`stdio: ['ignore', 'ignore', 'ignore']` on every spawnSync so a missing
`notify-send` or a failed `osascript` never clobbers the Ink TUI.

If any platform call throws, the whole notifier self-disables for the
session (avoids a broken install spamming stderr).

## Failure modes

- **macOS notification daemon disabled.** `osascript` returns
  non-zero; we swallow it.
- **Linux without notify-send / no DBus session.** Exit code non-zero;
  swallowed.
- **Windows without PowerShell.** Extremely rare; swallowed.
- **Running inside SSH with no local desktop.** Notifications fire on
  the local machine of whichever `agentwatch` process handles them.
  SSH remote notifications are future work.

## Custom triggers

Create `~/.agentwatch/triggers.json` with an array of rule objects.
**Edits are picked up live** — no restart required.

```json
[
  {
    "match": "curl .* \\| (bash|sh)",
    "title": "pipe-to-shell",
    "body": "{{agent}}: {{cmd}}"
  },
  {
    "type": "file_write",
    "pathMatch": "^/etc/",
    "title": "/etc write",
    "body": "{{agent}} wrote {{path}}"
  },
  {
    "thresholdUsd": 0.5,
    "title": "expensive turn",
    "body": "turn cost {{cost}}"
  }
]
```

### Rule fields

| Field | Type | Purpose |
|---|---|---|
| `match` | string (regex) | Tested against `summary\ncmd\npath` |
| `pathMatch` | string (regex) | Tested against `path` only — narrower |
| `type` | string | Restrict rule to a specific event type |
| `thresholdUsd` | number | Minimum per-turn cost before firing |
| `title` | string (required) | Notification title |
| `body` | string (required) | Notification body |

### Placeholders

`{{agent}}`, `{{type}}`, `{{cmd}}`, `{{path}}`, `{{tool}}`,
`{{summary}}`, `{{cost}}`. Unknown tokens expand to the empty string.

### Failure modes (triggers)

- Invalid regex → rule skipped silently.
- Rule missing `title` or `body` → dropped.
- Unreadable file → no user rules; built-ins still fire.
- Per-title rate limit (60s) still applies.

## Interactions

- Doesn't emit events or mutate state — side effect only.
- Rate-limit state is process-local (not persisted). Restarting
  agentwatch resets the cache.
- Triggers file is watched via chokidar; edits take effect on next event.
