# Use case: Catch a stuck loop before it eats your API budget

**Scenario.** Claude gets stuck retrying the same failing Bash command
15 times. You're in a different window and don't notice for 20 minutes.
By then: 40 minutes of wasted session, $4 spent repeating the same
error.

## With agentwatch today

Not fully automated in v0.3 — but you'd see:

1. Timeline scrolls with a stream of `shell_exec` events tagged
   `[proj] Bash: npm test` repeating
2. If the command has `rm -rf` or `sudo`, a desktop notification fires
   once (rate-limited). For normal-looking but pathological commands
   (looping npm test), no alert today.
3. Per-session cost in the agent side panel climbs rapidly — visible
   if you glance back at the TUI

## How agentwatch v1.0 will make this automatic

Tracked as AUR-117 (anomaly detection):
- Stuck-loop detector: same tool_use + same args ≥5 times in 60s →
  notification
- Cost-spike detector: session's cost-per-turn 3× the 7-day median
  for the project → notification
- Error-burst detector: ≥3 tool errors in 2 minutes → notification

## Today's workaround

1. Set `~/.agentwatch/triggers.json` (in v0.5) with
   ```
   [{ "name": "loop", "match": { "cmd": "npm test" },
     "notify": "desktop" }]
   ```
   For v0.3, custom triggers aren't configurable — only the hardcoded
   destructive-pattern rules fire.
2. Run agentwatch in a dedicated tmux pane always-visible.
3. Watch the cost counter.

## Without agentwatch

Discover the spent $4 on the Anthropic dashboard next morning.
