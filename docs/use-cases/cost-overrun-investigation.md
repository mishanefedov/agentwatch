# Use case: Daily cost tripled yesterday. Why?

**Scenario.** Your Claude Max / API spend jumped from ~$4/day to $12/day.
You want the session responsible, not a wild guess.

## With agentwatch

1. `agentwatch`
2. `P` → projects grid
3. Cards sorted by `lastTs`; the one with a suspiciously high yellow
   cost is obvious at a glance
4. `Enter` into that project
5. Yesterday's bucket — skim the sessions list, one row per session
   with cost per session
6. Spot the outlier (e.g. `[claude-code] "refactor the whole ingest
   pipeline"  8,214 events · 4h · $9.40`)
7. `Enter` — scoped timeline for that session
8. Flip through the detail pane of a handful of tool calls — check the
   `tokens / cost / duration` block
9. Discover: one bash ran `cat huge.log` producing 40 MB of tool
   output, each turn now sends that back as context — cache creates
   explode, cost spikes
10. Note the finding in your CHANGELOG / Linear

## What agentwatch is doing

- Per-agent + per-session cost uses cache-aware accounting. Naive tools
  that treat `cache_read_input_tokens` at full rate would report ~3-5×
  too high and still miss the real outlier because the absolute numbers
  all look crazy.
- Tool-result capping (256 KB) means the timeline buffer doesn't get
  blown up re-reading the 40 MB stdout; the detail pane shows
  `[N bytes truncated]`.

## Without agentwatch

Open Anthropic dashboard → aggregate numbers, no per-session drilldown.
Guess which session. `jq` through JSONL files. Give up.
