# Event detail pane

## Contract

**GOAL:** Full-screen overlay exposing every field of one selected event — prompt, tool input, tool result, thinking, tokens, cost.
**USER_VALUE:** Debug what an agent actually sent and received without tailing JSONL files by hand.
**COUNTERFACTUAL:** Users drop to a terminal, grep raw logs, and lose the context of the surrounding timeline.

## What it does

Full-screen overlay showing every field of the selected event: token
usage, cost, duration, full prompt/response text, tool input JSON, tool
result (stdout / file body / search matches), extended thinking.

## How to invoke

- Select a row with `↑↓` / `j k`
- Press `Enter`
- Inside the pane: `↑↓` / `j k` scrolls; `esc` closes

## Inputs

Reads the selected `AgentEvent.details`:
- `fullText` — prompt or response text
- `thinking` — extended-thinking blocks
- `toolInput` — tool_use arguments (JSON)
- `toolResult` — paired tool_result content
- `durationMs` — tool_use → tool_result delta
- `usage`, `cost`, `model` — per-turn token cost
- `toolError` — `is_error: true` flag

## Outputs

Rows grouped by section:
- Metadata (time, agent, type, tool, path, cmd)
- "tokens / cost / duration" block (only for assistant turns)
- "tool result" or "tool result (error)" — full output, red-colored on
  error, capped at 256 KB via `capBytes()`
- "text" — wrapped to terminal width
- "extended thinking" — dimmed
- "tool input" — JSON-pretty
- Pagination footer `1–20 of 47  ↑↓ scroll  [esc] close`

## Failure modes

- **Event has no details at all.** Shows "(no additional content captured
  for this event)".
- **`toolResult` exceeds 256 KB.** Truncated with `[N bytes truncated]`
  suffix (the cap is applied by the claude adapter at ingestion time).
- **Terminal resized while open.** Scroll offset clamps to the new max.

## Interactions

- Works with every event type. Some events are sparse (e.g. `session_start`
  just has metadata); that's intentional, not a bug.
- Does not change the underlying timeline filter/scope — closing returns
  to the exact same view.
