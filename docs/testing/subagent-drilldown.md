# Testing: subagent drilldown

## Prerequisites

- ≥1 Claude Code session where you used the `Task` / Agent tool
  (spawning a subagent). Look for a row in the timeline tagged
  `Agent: <description>` with `▸ N child events` suffix.

## Happy path

1. Select an Agent event.
2. Press `x`.
3. Breadcrumb shows `sub <agentId8>`.
4. Timeline shows only events whose `sessionId === agent-<agentId>` or
   whose `details.subAgentId === <agentId>`.
5. Scroll through — the subagent's Bash/WebFetch/Grep calls, prompts,
   responses.
6. `Enter` on any child event — detail pane works normally.
7. `y` to yank a child event — clipboard works normally.
8. `X` to unscope — returns to full timeline, prior filters preserved.

## Chaos tests

1. **Press `x` on a non-Agent event.** Silent no-op (only works on
   events whose `details.subAgentId` is set).
2. **Press `x` with nothing selected.** Silent no-op.
3. **Parent's tool_result never arrived** (session crashed). Subagent
   events still ingested from their own jsonl; drilldown just can't
   activate from the parent row. The child events are still visible
   in the main timeline.
4. **Agent tool_use with description longer than 100 chars.** Summary
   truncated; `▸ N child events` suffix still visible.

## Known limitations

- Only Claude Code subagents supported today. OpenClaw sub-agents are
  modeled differently (each is its own session) and drilled via the
  Sessions view, not `x`.
- subAgentId extracted by regex from tool_result text. If Claude's
  future format drops the `agentId` string, drilldown breaks until
  we update the extractor.
