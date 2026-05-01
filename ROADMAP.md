# agentwatch — roadmap

*Last updated: 2026-05-01. This doc is the navigation chart, not the
backlog. The backlog lives in Linear (`agentwatch` project, AUR-*).*

---

## TL;DR

We are at v0.0.4 with a credible TUI + web dashboard, six native agent
adapters, and three genuinely unique capabilities (multi-agent permission
surface, statistical anomaly detection, inter-agent call graph). The
category around us has consolidated faster than expected — three tools
between 1k–5k stars now ship persistent storage, headless capture, and
activity classification, none of which we have.

**Recommended path:** close the table-stakes gaps in the next 4–6 weeks
(daemon + SQLite + activity classification + git correlation + Claude
hooks), then publicly launch on the multi-agent + permission + anomaly
moat. Treat 0.1 as a re-introduction, not the launch.

---

## 1. Market landscape (May 2026)

The "watch your local agents" category has split into four lanes. Lanes
2 and 3 are where agentwatch competes; lanes 1 and 4 are *not* our
competition and we should stop comparing to them.

### Lane 1 — Cloud LLM observability *(not us)*

Langfuse, Arize Phoenix, Helicone, LangSmith, Datadog LLM Observability,
Braintrust, Maxim. All converged on the OpenTelemetry GenAI semantic
conventions standardized in March 2026. Built for production LLM apps,
not local coding agents. Charging $X/seat/month. Different problem.

### Lane 2 — Local cost trackers *(direct competition)*

| Tool | Stars | Agents | Storage | Differentiator |
|---|---:|---|---|---|
| **ccusage** | ~4.8k | Claude only | local cache | Fastest CLI, leanest, cited as "what most people install first" |
| **CodeBurn** | ~4.7k | 16 (Claude / Codex / Cursor / Gemini / Copilot / OpenCode / OpenClaw / Pi / Droid / Roo / Kilo / Qwen / Kiro / cursor-agent / Claude Desktop / OMP) | local | Activity classification (13 categories), one-shot rate, optimize-mode, model compare, plan tracking. Show HN 112 pts. |
| **AgentsView** (wesm) | 873 | 16 (Claude / Codex / Copilot CLI / Gemini / OpenCode / OpenHands / Cursor / Amp / iFlow / VSCode Copilot / Pi / OpenClaw / Kimi / Kiro CLI / Kiro IDE / Cortex Code) | **local SQLite + FTS** | "100x faster ccusage replacement," PostgreSQL sync for teams, desktop app, FTS on session messages. v0.26.1 on 2026-05-01. |
| **Claude Usage Tracker** | — | 9+ auto-detected | local | Heatmaps, monthly projections, scoped to cost. |
| **agentwatch (us)** | (pre-launch) | 6 | **in-memory + 4MB rolling backfill** | Multi-agent permission surface, anomaly detection, budget alarms, OTel exporter, MCP server mode, inter-agent call graph |

### Lane 3 — Hooks-based real-time monitors *(adjacent / partial competition)*

| Tool | Stars | Mechanism |
|---|---:|---|
| **disler/claude-code-hooks-multi-agent-observability** | 1.4k | Real-time WebSocket via Claude Code hook events → Vue dashboard. Captures all 12 hook event types. Tracks subagent/parent relationships. |
| **simple10/agents-observe** | smaller | Same idea, lighter |
| **nexus-labs-automation/agent-observability** | smaller | Plugin form |

These tools use Claude's *native* hooks API (`PreToolUse`, `PostToolUse`,
`SessionStart`, etc.) instead of tailing JSONL files. Trade-off: faster
and more reliable on Claude, but Claude-specific.

### Lane 4 — Provider-native + drop-in OTEL wrappers *(table stakes leakage)*

- **Claude Code `/cost`** (built-in since v2.1.92) — per-model
  breakdown, cache hit rate, rate-limit utilization. Free with Claude.
- **Claude Agent SDK observability** — built-in OpenTelemetry traces,
  metrics, log events out to OTLP. Anthropic's recommended path.
- **claude_telemetry / `claudia`** — drop-in CLI wrapper, ships traces
  to Logfire / Sentry / Honeycomb / Datadog. ~10 lines of config.

The signal here: Anthropic is putting basic cost tracking in-product.
"Show me my Claude spend" is no longer a moat. The moat is now
**everything `/cost` and ccusage do not do**: cross-agent, cross-tool,
permission, anomaly, control plane.

### What the HN comments (Show HN: CodeBurn, 112 pts) most asked for

1. **Parallel session tracking** — *"which of my 4 running sessions is
   burning the most tokens right now?"*
2. **Cost-optimization suggestions** — proactive *"you wasted X on
   re-reading the same file"*
3. **Windows support**
4. **Cursor-Agent CLI support**

We already ship 1, partially. We do not ship 2, 3, or 4.

---

## 2. Where agentwatch stands

### Genuinely unique (defend these)

| Capability | Status | Who else has it |
|---|---|---|
| Multi-agent permission surface (Claude / Codex / Gemini / Cursor / OpenClaw configs in one view) | shipped | nobody |
| Statistical anomaly detection (MAD z-score + stuck-loop period 1–4) | shipped | nobody |
| User-defined regex / threshold triggers (live-reloaded) | shipped | nobody |
| Per-session + per-day budget alarms with OS notifications | shipped | nobody |
| Inter-agent call graph (parent_span_id chain-linking) | shipped | nobody |
| MCP server mode (agents query their own history) | shipped | only CodeBurn ships an MCP, but read-only stats |
| OpenTelemetry exporter with `gen_ai.*` conventions | shipped | claude_telemetry (Claude only) |
| Hermes Agent adapter | shipped | nobody else covers Hermes |
| TUI + web in one process (single port, one keypress to open) | shipped | CodeBurn is TUI only; AgentsView has a separate desktop app |

### Table-stakes gaps (close these)

| Gap | Who has it | Why it matters |
|---|---|---|
| **Headless background daemon** (continuous capture without TUI open) | AgentsView, disler, claude_telemetry | Our README explicitly admits this. Competitors run 24/7. |
| **Persistent indexed storage (SQLite + FTS)** | AgentsView, ccusage cache | We have 4 MB rolling buffer. Loses data, can't do WoW trends. |
| **Activity classification per turn** (coding / debugging / exploration / planning) | CodeBurn (13 categories) | The #1 thing HN loved about CodeBurn. *"56% of my spend was on conversation turns with no tool usage"* — that line went viral. |
| **Git-correlation yield analysis** (sessions ↔ commits) | CodeBurn | Answers "is this spend producing code?" |
| **Side-by-side model performance compare** | CodeBurn | Plays to "should I be on Sonnet or Opus for this kind of work?" |
| **Subscription / plan tracking** (Claude Pro 5h limits, Cursor Pro caps) | CodeBurn, Claude Usage Tracker | High-perceived-value, low effort. |
| **Claude Code native hooks** (`PreToolUse`, `PostToolUse` etc.) | disler, nexus-labs | More reliable than JSONL tailing for Claude specifically. Anthropic's recommended path. |
| **Windows support** | CodeBurn, AgentsView | We've explicitly excluded it. Cuts ~30% of the addressable market. |
| **Unscoped npm name** | every competitor | `@misha_misha/agentwatch` reads as a personal project. |

### Distribution gap

We are at v0.0.4 with a published-but-buggy npm package, no Show HN, no
README hero metric ("X stars" — we have none yet), and the GitHub name
`agentwatch` collides with cyberark/agentwatch (Python SDK observability
for LangGraph/Autogen — different product, different audience, but
muddies search). Every direct competitor has an order-of-magnitude head
start in stars and a clearer name.

---

## 3. The fork in the road

Three honest directions. We pick one.

### Direction A — *Catch up + lean on uniques.* Conservative.

**Story:** "ccusage and CodeBurn are great if you only use one agent. If
you run Claude + Codex + Gemini + Cursor + OpenClaw on the same machine,
you need a tool that knows about all of them, watches their permissions,
catches their loops, and warns you when one is melting your card."

**Investment:** 4–6 weekends.

- Close 5 of the 9 table-stakes gaps (daemon, SQLite, activity
  classification, git correlation, hooks).
- Punt Windows + plan tracking + side-by-side compare to v0.2.
- Ship 0.1 with a Show HN.

**Ceiling:** plausibly 1k stars in 6 months, 5k–10k in 12 months if the
multi-agent angle resonates. Becomes a credible Lane-2 player. No
revenue. Pure tool / credibility artifact.

**Risk:** low. We are technically ahead on the unique features and
behind on the table stakes. Closing the gap is bounded engineering.

---

### Direction B — *Leapfrog: hooks-native, multi-agent, control-plane.* Ambitious.

**Story:** "Anthropic gave Claude Code a hooks API in 2026. Use it.
Combine native hooks for Claude with file-tailing for everything else,
add the missing layer everyone's faking with regex: real
*intervention.* Block destructive Bash before it runs. Cap budgets in
real time. Approve sensitive edits before they hit disk. agentwatch is
the local control plane the multi-agent stack does not have."

**Investment:** 8–12 weekends.

- Everything in Direction A, plus:
- Native hooks integration (Claude blocking via `PreToolUse`).
- Real-time approval forwarding (existing OpenClaw approval pattern,
  generalized).
- Policy editor that *enforces*, not just reports.
- Replay-as-validation (run the same prompt against three models, pick
  the cheapest that passes).

**Ceiling:** materially higher than A. The control-plane category is
mostly empty (Castra / DashClaw exist but are pre-1k-star). If we
land first with a credible product, we own the category.

**Risk:** medium-high. Breaks the README's "not an agent itself, not
governance, not orchestration" non-goal. Puts us in conflict with
Anthropic's own Compliance API. Bigger surface, more bugs.

---

### Direction C — *Pure cost analytics, sharper than CodeBurn.* Conservative-narrow.

**Story:** drop the TUI / web / permissions / anomaly / OTel /
multi-agent framing. Compete head-on with ccusage and CodeBurn on the
single axis of *cost analytics done well.*

**Investment:** 2–3 weekends.

- Remove most of the v0.0.3–0.0.4 surface area.
- Sharpen on activity classification + git yield + model compare.

**Ceiling:** capped. ccusage and CodeBurn already exist and have
4–5k-star moats. We'd be third in a race that's already half-run.

**Verdict:** rejected. Throws away our actual differentiation.

---

## 4. Recommended path: A first, evaluate B at v0.2

Direction A is the obvious near-term move because:

1. The table-stakes gaps are bounded engineering with clear acceptance
   criteria. No new product invention.
2. Closing them lets us re-enter the category with a defensible pitch.
3. Direction B is best evaluated *after* we have user signal. Picking
   it now without users is choosing complexity blind.

Concretely: ship 0.1 with daemon + storage + classification + git +
hooks; do the Show HN; collect 90 days of feedback; *then* decide if
Direction B's control-plane bet is worth the non-goal break.

If the Show HN lands at >150 points and we hit 500 stars in week one,
Direction B becomes the obvious v0.3 bet. If it lands quietly, we stay
in Direction A and harden the multi-agent + anomaly story.

---

## 5. Phased plan

### v0.0.5 — *cleanup release* (this week)

Ship the Apr 27 robustness fixes that are sitting in `[Unreleased]`.

- Externalized pricing via `~/.agentwatch/pricing.json` (AUR-216, done)
- OpenClaw toolResult pairing (AUR-217, done)
- Surface unparseable JSONL lines (AUR-228, done)
- Compaction docs for Gemini/OpenClaw structural limit (AUR-214, done)
- Defensive directives initializer (AUR-242, done)
- Cron timeout wrappers (AUR-241, done)
- Bump version, write CHANGELOG, publish.

**Acceptance:** `npm i -g @misha_misha/agentwatch@0.0.5` works on a
fresh machine, doctor passes, no buggy label.

---

### v0.1 — *the launch release* (next 4–6 weeks)

Goal: be a credible Lane-2 entrant with a defensible "multi-agent +
permission + anomaly" pitch. Ready for Show HN.

**Must have (all five):**

1. **Background daemon** (`agentwatch daemon start | stop | status`).
   Continuous capture, runs as a launchd / systemd service, survives
   TUI close. Pipes to:
2. **SQLite event store** (`~/.agentwatch/events.db`) with FTS5 on
   prompt/response/tool-result text. Replaces the 4 MB rolling buffer.
   Backfill old JSONLs into it on first run.
3. **Activity classification per turn** (≥10 categories: coding /
   debugging / exploration / planning / refactor / test / docs /
   chat / config / review). Ships per-session and per-week
   breakdowns in the web UI.
4. **Git-correlation yield view** — pair sessions with the commits
   they produced, show $/commit and "spend without commit" sessions.
5. **Claude Code native hooks adapter** — alongside JSONL tailing.
   Real-time `PreToolUse` / `PostToolUse` events, no polling lag.
   Falls back gracefully if hooks aren't configured.

**Should have:**

6. Unscoped npm name. Pick one of: `agentwatch-cli`, `agw`, `agentlens`,
   `cdwatch`. Verify GitHub + npm + domain availability before release.
7. WoW trends view (cache-hit ratio drift, AUR-215). Already in
   progress. Daemon + SQLite makes this trivial.
8. Aider + Cline + Continue + Windsurf adapters (file-tail; same
   pattern as Codex / Gemini).
9. Cursor SQLite adapter (closes the only ⓟ at half-coverage in our
   matrix).

**Could have (defer to v0.2 if compressing):**

10. Plan tracking (Claude Pro 5h limit, Cursor Pro caps).
11. Side-by-side model compare view.
12. Windows support.

**Acceptance gates:**

- `agentwatch daemon` runs for 7 days continuously on the maintainer's
  machine without crash or memory leak.
- SQLite db is < 200 MB after 30 days of typical use.
- Activity classifier hits ≥75% agreement with hand-labelled ground
  truth on a 200-turn validation set.
- Show HN draft + screenshots ready (lean on call-graph + permission +
  multi-agent timeline GIFs, not generic cost charts).
- README rewritten so "vs CodeBurn / vs AgentsView / vs ccusage" sits
  at the top and is honest.

**Distribution:**

- Show HN
- r/ClaudeAI cross-post (their FAQ links to ccusage; aim for similar
  treatment)
- r/LocalLLaMA cross-post
- Tweet thread with the call-graph demo as the lead asset

---

### v0.2 — *harden + reach* (~Q3 2026)

Goal: convert v0.1 momentum into a 3k-star tool.

- **Windows support** (chokidar + notifier testing; don't promise until
  it works on a clean Win11 box).
- **Side-by-side model compare** (replay a turn across 3 models, show
  cost / time / output quality).
- **Plan tracking** (Claude Pro 5h, Cursor Pro caps, OpenAI tier limits).
- **Cost-optimization suggestions** — the *"56% of your spend is
  conversation"* thing CodeBurn went viral on. We have the data; just
  add the surfacing.
- **`agentwatch open <hash>`** — deep-link from the OS notifier into
  the relevant event detail.
- **Stable schema 1.0** — `src/schema.ts` becomes a public contract.
- **Plugin SDK** — `agentwatch.config.ts` lets users register custom
  classifiers, triggers, exporters without forking.
- **Cross-machine sync** (opt-in; user-supplied Postgres or LiteFS
  endpoint; mirrors AgentsView's PostgreSQL sync feature). Keeps the
  "no cloud" invariant by being BYO endpoint, not a service.

---

### v0.3 — *evaluate Direction B* (~Q4 2026)

Decision point. Based on v0.1 + v0.2 signal:

**If the multi-agent + permission story is resonating** (≥3k stars,
recurring "we deployed this team-wide" feedback): start the control
plane.

- Native Claude hooks blocking (`PreToolUse` returning `decision:
  "block"` for matched policies)
- Approval forwarding (Telegram / Slack / desktop)
- Policy DSL (built on the existing trigger schema)
- Replay-as-validation gate

**If it isn't resonating:** drop deeper into single-purpose excellence.
Ship the missing classifier / yield / compare / Windows / plan
features harder. Stay in Lane 2 and try to be the best Lane-2 player.

---

### v1.0 — *stable* (~end of 2026)

Whatever direction we picked at v0.3, v1.0 stabilizes the schema, locks
the CLI contract, and earns SemVer guarantees. v1.0 is not a feature
release.

---

## 6. Rejected directions (so we don't drift)

- **Cloud / SaaS / hosted dashboard.** Hard non-goal. Local-first is
  the trust premise. Anyone who wants cloud goes to Langfuse.
- **Production LLM-app tracing.** Langfuse / Phoenix / LangSmith own
  this. We are coding-agent specific.
- **Becoming an agent ourselves.** Direction B's control-plane bet is
  the closest we'd get; even there, we *enforce policy*, we don't
  *take actions*.
- **Compliance / governance for enterprise.** Anthropic's Compliance
  API exists. We don't have the sales motion to compete.
- **Memory / context layer.** claude-mem and friends own that.
- **Orchestration / parallel agent dispatch.** Mission Control,
  Stoneforge, Cursor's Manager Surface own that.
- **An LLM evaluation harness.** Promptfoo / Langfuse / Braintrust own
  that. Replay is a debugging tool, not an eval suite.

---

## 7. Success metrics

We track three numbers, monthly:

| Metric | v0.1 target (90d) | v0.2 target (180d) | v1.0 target (360d) |
|---|---|---|---|
| GitHub stars | 500 | 3,000 | 10,000 |
| Weekly active installs (telemetry-free, inferred from npm download trend + GH traffic) | 200 | 1,500 | 5,000 |
| Daemons running > 7 days continuous (self-reported in survey at v0.2 release) | n/a | 100 | 800 |

Stars are vanity but they're the legible signal in this category;
ccusage / CodeBurn / AgentsView all sit on stars as their primary
proof. Weekly active is the truer signal once we have it.

If at 90d we are < 200 stars and Show HN < 80 points, the recommended
path was wrong; revisit Section 3 fork.

---

## 8. Operating principles

These don't change between v0.1 and v1.0:

- **Local-first.** Zero outbound network unless the user sets
  `AGENTWATCH_OTLP_ENDPOINT` to their own collector.
- **Read-only by default.** Disk is touched only on explicit `e`
  (export) and clipboard on explicit `y`.
- **No telemetry.** Not opt-in, not opt-out — not present.
- **MIT license.**
- **macOS + Linux first.** Windows is a v0.2 ambition, not a blocker
  for v0.1.
- **Multi-agent first.** If a feature only helps Claude users, we ship
  it only after the equivalent works for at least two other agents
  *or* there is no equivalent for the others (e.g. Claude hooks).

---

## 9. Open questions

Resolve before v0.1 ships:

- **Name.** Stay with `@misha_misha/agentwatch`, or rebrand? CyberArk
  collision is a real friction.
- **Daemon transport.** Local UDS, localhost HTTP, or just shared
  SQLite + advisory locks? Affects how the TUI / web / MCP-server
  three-way split coexists.
- **Activity classifier.** Heuristic-only (cheap, deterministic, ships
  fast) or use a small local model (better accuracy, dependency)?
- **Hooks fallback.** If the user hasn't configured Claude hooks,
  silently fall back to JSONL tailing, or prompt them to install via
  `agentwatch hooks install`?

---

*Backlog detail lives in Linear (project: agentwatch). This doc covers
direction; tickets cover execution.*
