# Testing: timeline

## Prerequisites

- Claude Code installed and with ≥1 session in history
- TUI launched via `npm run dev`

## Happy path

1. After launch, wait 3 seconds — backfill should have events on screen.
2. Verify the column header reads `TIME · AGENT · TYPE · EVENT` and
   stays pinned as events scroll.
3. In another terminal, run `claude` and type a short prompt.
4. Within 2 seconds, a new `prompt` event with a fresh timestamp appears
   at the top of the timeline (reverse-chrono).
5. Claude responds — `response` event appears.
6. If Claude executes tools, those rows show `Bash: …` / `Read: …` with
   proper risk colors.

**Pass criteria:**

- No missed live events
- Events consistently ordered by timestamp, newest first
- Rows never wrap — each is exactly one line, truncated with `…`

## Chaos tests

1. **Corrupt a session JSONL mid-stream.** Append `not valid json\n` to
   an active `~/.claude/projects/<proj>/<session>.jsonl`. The adapter
   should skip the malformed line and keep parsing later lines.

2. **Future-dated timestamp.** Append a line with `"timestamp":
   "2099-01-01T00:00:00.000Z"`. Event should appear, but not pinned to
   the top of the list (clamp clamps it to now+60s max).

3. **10,000 events in a single session.** Run a long Claude session.
   Backfill should complete in <3 seconds. Buffer should cap at 500
   events — oldest fall off the tail.

4. **File truncated to zero bytes.** `> ~/.claude/projects/.../x.jsonl`
   (empty file). Adapter should not crash. New events appended later
   are picked up.

## Known limitations

- Event buffer cap of 500 means older events drop. Drill into specific
  sessions via `P` → project → session for full history.
- Backfill reads the last 64 KB of each session file. Very long sessions
  won't surface their earliest events in the main timeline.
