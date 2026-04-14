# Use case: Why did my research subagent take 6 minutes?

**Scenario.** You spawned a Claude `Task` to do web research. It came
back with a mediocre answer after 6 minutes and $0.08 in spend. You
want to know what it actually did — every inner tool call, every
attempted fetch, how much time each took.

## With agentwatch

1. `agentwatch`
2. In the timeline, find the parent Agent event. It shows:
   ```
   10:13:25  claude-code  tool_call  [auraqu] Agent: Multi-agent dev pain research  ▸ 52 child events
   ```
3. Select it. Press `x` → timeline scopes to the subagent's inner run.
4. Breadcrumb: `sub ab3c99fc`.
5. 52 events visible: Bash (curl), WebFetch, Grep, Read, prompts to
   itself, responses. Each row shows duration (`· 151ms · 3.2s · ERR`).
6. Browse the list — notice 8 WebFetch calls failed with `· ERR`
   against the same unreachable domain. The subagent retried instead
   of pivoting.
7. `Enter` on one of the failed WebFetches — detail pane shows the
   URL, the error message, the duration.
8. Understand: the failure mode was DNS, not the research question.
9. `X` to unscope.

## What agentwatch is doing

- Ingesting `~/.claude/projects/<session>/subagents/agent-<id>.jsonl`
  (otherwise invisible).
- Regex-extracting `agentId` from the parent's tool_result, linking
  parent row to subagent events.
- Pairing each `tool_use` with its `tool_result` for duration + content
  + error flag.
- Aggregating total duration and event count onto the parent row.

## Without agentwatch

Grep `~/.claude/projects/.../<session>/subagents/` by hand. No
duration info, no error attribution.
