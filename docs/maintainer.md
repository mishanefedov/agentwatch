# Maintainer agent

A headless Claude Code session that runs once a day, keeps the repo healthy,
and watches the outside world for signal. It is **not** part of the shipped
product — it maintains this repo.

## What it does per run

1. Syncs `main`.
2. Triages open issues (investigate, reply, label) and reviews open PRs
   (CI status, convention violations). Never merges.
3. If `main` CI is red, fixes it on a branch + PR.
4. Implements at most **one** issue labeled `approved` — the human grants that
   label; the agent never picks its own feature work.
5. Scans Hacker News (Algolia API) and Reddit (r/ClaudeAI, r/LocalLLaMA,
   r/ChatGPTCoding) for mentions, feature asks, and competitor moves from the
   last 24 h; posts a digest comment on the pinned "📡 Signal digest" issue and
   files `scraped,proposal` issues for concrete, roadmap-compatible ideas.

The full instruction set (including guardrails) is the slash command at
[`.claude/commands/maintain.md`](../.claude/commands/maintain.md).

## Guardrails

- Branch + PR only; never pushes `main`, never merges, never closes others'
  issues.
- One implementation PR per run, tests/typecheck/build green before opening.
- Network surface: GitHub, `hn.algolia.com`, `reddit.com`. Nothing else.
- Scraped ideas become *proposals*, not code — implementation requires the
  human-granted `approved` label.

## Install (macOS)

```bash
# 1. Dedicated clone (keeps your working copy out of the agent's hands)
gh repo clone mishanefedov/agentwatch ~/IdeaProjects/agentwatch-maintainer

# 2. launchd job — daily 07:30
sed "s|\$HOME|$HOME|" ~/IdeaProjects/agentwatch-maintainer/scripts/maintainer/com.agentwatch.maintainer.plist \
  > ~/Library/LaunchAgents/com.agentwatch.maintainer.plist
launchctl load ~/Library/LaunchAgents/com.agentwatch.maintainer.plist

# 3. Dry run to verify
~/IdeaProjects/agentwatch-maintainer/scripts/maintainer/run.sh --dry-run
tail -f ~/.agentwatch-maintainer/logs/$(date +%Y-%m-%d).log
```

Requires the `claude` CLI authenticated (subscription login works; runs count
against your plan's rate limits) and `gh` authenticated with repo scope.

Headless runs can't answer permission prompts, so the clone needs a
`.claude/settings.local.json` allowlist (not committed; create it in the
clone):

```json
{
  "permissions": {
    "allow": [
      "Bash(git:*)", "Bash(gh:*)", "Bash(npm:*)", "Bash(node:*)",
      "Bash(curl -s https://hn.algolia.com/*)",
      "Bash(curl -s -A agentwatch-maintainer https://www.reddit.com/*)",
      "WebFetch(domain:hn.algolia.com)", "WebFetch(domain:www.reddit.com)"
    ]
  }
}
```

## Operate

```bash
launchctl start com.agentwatch.maintainer     # run now
launchctl list | grep agentwatch              # status / last exit code
launchctl unload ~/Library/LaunchAgents/com.agentwatch.maintainer.plist  # disable
```

Logs: `~/.agentwatch-maintainer/logs/YYYY-MM-DD.log` (one file per day).
And yes — agentwatch's own cron surface watches this launchd job.
