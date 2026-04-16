# Subagent drilldown

## Contract

**GOAL:** Scope the timeline to a single Claude-Code subagent's inner tool calls.
**USER_VALUE:** Post-mortem "what did this delegated task actually do" without parsing the parent session log.
**COUNTERFACTUAL:** Subagent activity drowns in the parent session; failed delegations go unnoticed.

## What it does

Claude Code's `Task` (Agent) tool spawns a subagent with its own inner
tool calls. Claude writes those into
`~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl`.

agentwatch ingests both the parent session and every subagent file, and
lets you scope the timeline to one subagent's inner calls on demand.

## How to invoke

- Find a parent `Agent` tool_use event. They show `▸ N child events` in
  the row suffix.
- Press `x` with that row selected.
- Timeline now shows only events from that subagent's run.
- Press `X` (shift-x) to unscope.

## Inputs

- Parent Claude Code assistant message with `tool_use.name === "Agent"`.
  Its tool_use_id is recorded.
- Parent's matching tool_result. The result's flattened content contains
  `"agentId":"<hex>"` or `agentId: <hex>` (extracted by regex in the
  claude adapter).
- Subagent JSONL file at
  `…/<mainSessionId>/subagents/agent-<agentId>.jsonl` (watched via the
  same adapter, tagged `sessionId: "agent-<agentId>"`).

## Outputs

- Parent Agent event row gets `▸ N child events` appended, where N is the
  count of events whose `sessionId === "agent-<subAgentId>"`.
- When scoped (`x`), a yellow breadcrumb segment `sub <agentId8>` shows
  in the header, and the timeline filters to matching events.
- `X` removes the scope and restores whatever filters were active.

## Failure modes

- **Parent tool_result never arrives.** The subagent events still appear
  in the timeline (they were ingested from their own file), but no
  `subAgentId` is attached to the parent, so `x` does nothing on that
  row.
- **agentId regex fails to match** (format changed upstream). Same
  degradation — events visible, drilldown link missing. Safe failure.
- **Subagent file is created before parent tool_result** (rare). Events
  surface; drilldown activates when the result is paired.

## Interactions

- Combines with agent filter + project filter + search: scoping by
  subagent further narrows the already-filtered view.
- Inside a scoped view, the detail pane, search, and yank all work as
  normal.
- OpenClaw sub-agents are a different concept: each OpenClaw sub-agent
  (content, research, docs, main) is its own parallel session — see
  [sessions-nav](./sessions-nav.md).
