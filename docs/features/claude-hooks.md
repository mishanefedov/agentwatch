# Claude Code native hooks (AUR-266)

## Contract

**GOAL:** Capture every Claude Code lifecycle event in real time via the official hooks API, alongside JSONL tailing.
**USER_VALUE:** Sub-1-second visibility into what Claude is doing — destructive `rm`, `.env` reads, prompt submits — instead of waiting on file-watcher debounces. Operators who run multiple Claude sessions can react before damage lands.
**COUNTERFACTUAL:** Without it, every Claude observation is delayed 1–2 seconds by JSONL polling and we miss sub-events that never reach the transcript.

Claude Code ships a hooks API that runs a configured shell command on
every important event in the agent lifecycle (`SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`,
…). Hooks fire in real time — no JSONL parsing lag, no missed
sub-events, no waiting on file-watcher debounces.

agentwatch can install itself as a hook and have Claude push every
event into our normal pipeline as it happens.

## Install

```sh
agentwatch hooks install
```

Writes hook stanzas into `~/.claude/settings.json` for every event
type we recognize. Each stanza is a one-line `curl` that POSTs the
hook payload (which Claude provides on stdin) to
`http://127.0.0.1:3456/api/hooks/<EventName>`. The curl uses `-m 1`
(1-second timeout) and `exit 0` so a dead agentwatch never blocks
Claude.

The stanzas are tagged `# [agentwatch-managed]` so we can find and
remove them later without disturbing user-defined hooks.

```sh
agentwatch hooks status
```

Reports `installed`, `not-installed`, or `partial` (some events
managed, others not). `agentwatch doctor` includes the same line.

```sh
agentwatch hooks uninstall
```

Removes only the agentwatch-tagged stanzas. Any other hooks the user
has configured stay in place.

## How dedup works

Hook events arrive about 1–2 seconds before the same event lands in
the JSONL transcript. To avoid double-counting, the JSONL adapter's
emit goes through `withClaudeHookDedup`, which:

- For `claude-code` events with `details.source !== "hooks"` — looks
  up `(sessionId, toolUseId)` in a 5-second registry. If marked, the
  event is dropped.
- For `claude-code` events with `details.source === "hooks"` — bypass
  the check (hook events never dedup against themselves) and continue
  to the rest of the pipeline.

The hook adapter calls `markHookSeen(sig)` *before* `sink.emit`, so by
the time the JSONL event arrives the registry has already been
updated.

When `tool_use_id` is missing (hooks without an obvious correlation
key — `SessionStart`, `Notification`, etc.) we don't dedup; both
versions appear, but they represent fundamentally different shapes
(hooks have no token / cost data; JSONL has them) so the duplication
is informational rather than noisy.

## Why this is in addition to the JSONL adapter, not a replacement

Hooks deliver events *as they happen* — perfect for blocking-decision
work (the v0.3 control-plane bet) and for any operator who wants
sub-1s reaction time on `rm`, `.env` reads, etc.

JSONL has the assistant's full response text, the tool result, the
extended-thinking block, token usage, and cost. Hooks don't. The two
sources are complementary; we keep both running and let dedup fall
out.

## Configuration

| Path | What |
|---|---|
| `~/.claude/settings.json` | Hook stanzas (managed by `hooks install`) |
| `~/.agentwatch/events.db` | Hook events land here just like everything else |

There are no agentwatch-specific environment variables for hooks —
the install command resolves the port from `--port` / `AGENTWATCH_PORT`
and bakes it into the curl command at install time.

## Out of scope (v0.1)

- **Hook-based blocking** — Claude hooks support returning JSON with
  `decision: "block"` to veto a tool call before it runs. That's the
  control-plane bet on the v0.3 roadmap; the v0.1 adapter is
  observe-only.
- **Hooks for agents other than Claude Code** — Cursor / Codex /
  Gemini / OpenClaw don't ship a hooks API. JSONL or SQLite tailing
  remains the path for them.
