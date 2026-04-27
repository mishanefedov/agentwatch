# Compaction visualizer

## Contract

**GOAL:** Show, per session, where the agent's context window filled up and where it was reset, so operators can attribute behavior changes to a specific compaction event.
**USER_VALUE:** Spot the moment a session "forgot" earlier context — the cause of "why did it suddenly redo work?" — without re-reading the full timeline.
**COUNTERFACTUAL:** Without compaction markers, the timeline implies an infinitely growing context. Operators chase phantom regressions caused by silent resets.

## What it does

Per session, walks the assistant turns in order and produces one
`CompactionPoint` per turn (token fill %) or per compaction marker
(fill-before + fill-after of the reset). Renders as a horizontal bar
chart inside the TUI (`C` key from a scoped session).

Built from `src/util/compaction.ts` → `buildCompactionSeries(events, sessionId, window)`.

## Per-agent support matrix (AUR-214)

The visualizer is only as good as the underlying compaction signal each
adapter can extract. State as of this commit:

| Agent | Compaction marker emitted | Source |
|---|---|---|
| Claude Code | ✓ | `isCompactSummary: true` on user turns in `~/.claude/projects/<proj>/<sess>.jsonl` |
| Codex | ✓ | `event_msg` payload of type `turn_truncated` (or future `compaction`) in `~/.codex/sessions/rollout-*.jsonl` |
| Gemini CLI | ✗ | **Structural limitation** — Gemini chat JSON (`~/.gemini/tmp/<proj>/chats/session-*.json`) carries only `user`/`gemini`/`error`/`info` message types. The CLI's `/compress` command rewrites context in-place but does not persist a marker. We surveyed every session under `~/.gemini/tmp/*/chats/` and found no compaction-shaped record. The visualizer therefore has no compaction events to plot for Gemini sessions; the fill curve will show monotonically growing input until the chat ends. |
| OpenClaw | ✗ | **Structural limitation** — `~/.openclaw/agents/*/sessions/*.jsonl` records `session`, `message`, `model_change`, `thinking_level_change`, `custom`, `custom_message`. The `custom` event subtypes seen in the wild are `model-snapshot`, `openclaw:bootstrap-context:full`, `openclaw:prompt-error`. The `custom_message` subtype `openclaw.sessions_yield` is a parent → child handoff signal, not a context reset. We checked every active OpenClaw session and found nothing equivalent to `isCompactSummary`. |
| Cursor | n/a | Cursor's session storage is config-only in our adapter (no full activity stream). |
| Hermes | n/a | Hermes uses a SQLite store with prompt/response messages; no compaction protocol surfaced. |

### What changes if Gemini or OpenClaw start persisting a marker

If a future Gemini CLI release adds a chat-compress marker to the JSON
(e.g. an `info` message with content matching `^Context compressed:`,
or a new `type: "compaction"` block), wire it through
`src/adapters/gemini.ts` to emit `EventType: "compaction"` with an
appropriate `summary`.

For OpenClaw, the most plausible signal is a future `custom`-event
`customType: "openclaw:context:compact"` (or similar). Add a branch in
`src/adapters/openclaw.ts → translateSession` that emits
`EventType: "compaction"` for that type.

Until then: don't synthesize compaction events from indirect signals
(big drop in `cacheRead`, model swap, etc.) — false positives in this
view are worse than the current honest blank.

## How to invoke

- Inside the TUI: drill into a session, then press `C`.
- Per-session API: `GET /api/sessions/:id/compaction` (renders the same
  series as JSON for the web UI).

## Failure modes

- **Unknown context window for the model.** Falls back to 200k. The
  fill axis is then proportional but not absolute. Operators can
  override via `AGENTWATCH_CONTEXT_WINDOW=<tokens>`.
- **Adapter never emits `EventType: "compaction"`.** Visualizer plots
  fill but no reset markers — see matrix above.
- **Session events arrive out of order.** `buildCompactionSeries`
  walks events in `ts` order; clock skew is clamped at the schema layer
  (see `clampTs`).

## Interactions

- The fill axis uses `details.usage.{input, cacheRead}` from the
  per-turn enrichment (cost adapter). Sessions without usage data
  produce a flat zero curve.
- Anomaly detection (AUR-180) does not yet consume compaction series
  but the n-gram detector intentionally treats post-compaction turns as
  fresh windows.
