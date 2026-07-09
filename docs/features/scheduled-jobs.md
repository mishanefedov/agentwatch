# Scheduled jobs

## Contract

**GOAL:** One read-only surface listing every background/scheduled agent job on the machine — OpenClaw cron + heartbeats, macOS launchd user agents, and the user crontab.
**USER_VALUE:** Answer "what's running unattended on this box, and is it healthy?" without hand-checking three different subsystems (`openclaw cron list`, `launchctl list`, `crontab -l`).
**COUNTERFACTUAL:** A launchd agent silently dies (`LastExitStatus` != 0) or a stray crontab entry keeps firing an old agent script, and nobody notices until it causes damage or the human stumbles on it by accident.

## What it does

The `/cron` route (`GET /api/cron`, `web/src/routes/Cron.tsx`) surfaces
four independent sources of scheduled/background agent activity on one
page:

- **OpenClaw cron jobs** — `~/.openclaw/cron/jobs.json` via
  `src/util/openclaw-cron.ts`.
- **OpenClaw heartbeats** — `HEARTBEAT.md` per workspace via
  `src/util/openclaw-heartbeat.ts`.
- **launchd user agents** (macOS only) — every `~/Library/LaunchAgents/*.plist`
  via `src/util/launchd-agents.ts`, joined with live health from
  `launchctl list <label>`.
- **crontab** — the current user's `crontab -l` via `src/util/crontab.ts`.

Jobs whose program/arguments/command mention a known AI agent binary
(`claude`, `codex`, `gemini`, `openclaw`, `agentwatch` — see
`src/util/agent-mention.ts`) are flagged with an `agent` badge so
agent-related scheduled work stands out from ordinary system cron/launchd
noise.

## How to invoke

Open the `/cron` (scheduled) route in the web UI. Data refetches every
10s (`refetchInterval` in `Cron.tsx`).

## Inputs

- `readCronJobs()` / `readAllHeartbeats()` — existing OpenClaw parsers,
  unchanged.
- `readLaunchdAgents()` — parses each plist (XML in-process; binary
  plists normalized via `plutil -convert xml1 -o - <file>`), extracts
  `Label`, `Program`/`ProgramArguments`, and derives a human schedule
  string from `StartCalendarInterval` / `StartInterval` / `RunAtLoad`.
  Joins `launchctl list <label>` for `PID` (running) and
  `LastExitStatus`. Returns `[]` on non-macOS.
- `readCrontab()` — runs `crontab -l`, parses each non-comment,
  non-env-assignment line into `{ schedule, command }`. A non-zero exit
  (no crontab installed) is treated as an empty list, not an error.

## Outputs

`GET /api/cron` → `{ jobs, heartbeats, launchd, crontab, scheduledEvents }`.
Existing fields (`jobs`, `heartbeats`, `scheduledEvents`) are unchanged
for backward compatibility; `launchd` and `crontab` are additive.

## Failure modes

- **Non-macOS host**: `launchd` is always `[]`; the UI shows "No launchd
  user agents detected."
- **No crontab installed**: `crontab` is `[]`; the UI shows "No user
  crontab installed."
- **launchd job not loaded / launchctl unreachable**: `loaded: false,
  running: false` rather than a thrown error — job still listed with its
  plist-derived schedule, just marked not running.
- **Corrupt or unreadable plist**: that file is skipped; the rest of the
  discovery continues.

## Interactions

- Read-only, local-only: never writes to crontab or plists.
  `plutil -convert xml1 -o -` writes to stdout only (`-o -`), never back
  to the file. `crontab -l` and `launchctl list` are the only shell-outs.
