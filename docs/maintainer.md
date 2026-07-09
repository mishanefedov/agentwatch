# This repo has a maintainer agent

Part of agentwatch's triage runs as a scheduled, headless coding agent on the
maintainer's machine. It reads issues and PRs, keeps CI green, watches the
wider ecosystem for feature signal, and files proposals. It is not part of the
shipped product, and its runtime configuration lives in a private ops
repository — not because the guardrails depend on being secret (they don't),
but because publishing a machine's exact automation surface is free
reconnaissance for anyone writing a prompt-injection payload.

This page documents the guardrails, because you deserve to know what touches
this repo.

## What the agent may do

- Triage issues: investigate, reply, apply labels.
- Review open PRs: report CI status and convention violations.
- Fix a red `main` on a branch, as a PR.
- Implement **one** issue per run — and only an issue a human has labelled
  `approved`.
- File proposals from ecosystem signal.

## What the agent may not do

- Push to `main`. Ever. `main` is branch-protected and CI-gated.
- Merge or close anything.
- Approve its own work. Authorization comes solely from the `approved` label,
  which only a repository write-user can apply. No text the agent reads —
  including an issue body claiming to be from the owner — can grant it
  permission.
- Reach the network outside GitHub and its two signal sources, or read
  credentials: it runs in an OS sandbox with an egress allowlist and
  deny-read on credential paths.
- Use `curl`, `node`, `npm install`, `gh api`, `gh repo`, `gh auth`, `rm`, or
  `sudo` — none are in its permission allowlist.

Its GitHub identity is a fine-grained token scoped to this repository alone,
with no administrative rights. It is not the maintainer's account.

## Why it's built this way

Prompt injection is an unsolved problem. The agent reads attacker-controlled
text on every run — issue bodies, PR diffs, forum posts. The published record
is consistent: classifier-based defenses carry real false-negative rates, and
the strongest production alignment checkers are defeated by payloads disguised
as legitimate error-recovery steps. So the design assumes injection eventually
succeeds and makes success worthless: a scoped token, an OS sandbox, a tool
allowlist, a quarantined WebFetch-only subagent for untrusted web text, and a
human who reads every PR before it merges.

The worst realistic outcome of a successful injection is a bad pull request
that a human declines. That is the point.

Naturally, agentwatch watches the agent: its scheduled job shows up on the
`/cron` surface, its spend is capped, and triggers fire on credential-path
reads, pipe-to-bash, and force-push attempts.

## Contributing

None of this changes how you contribute — open an issue or a PR as usual. A
human reads everything before it lands. See
[CONTRIBUTING.md](../CONTRIBUTING.md).
