# PROGRESS — session-correlation work split (2026-05-04)

**Original target:** AUR-115 — *Cross-agent session correlation (Claude session → Cursor session stitched)*
**Status:** plan superseded — **do not implement AUR-115 directly**.
**This branch:** `misha/aur-276-session-correlation-telemetry` — implements AUR-276 (telemetry half).

The original 4-hour plan (full architecture + schema + correlator + API + React UI) drafted earlier today was paused after a GBrain query surfaced **AUR-183** — the same feature, cancelled 2026-04-15 for the same milestone (M7 v1.0). The cancellation rationale was that without user-labeled confirmation pairs, false-positive rate is ~10–15% and the UI can't be trusted. The new plan's stricter rule (exact path + 30-min window + same git branch + same workspace root) likely lowers FP — but still ships an unverified flagship feature with no measurement.

## New plan — 2-ticket split

| Ticket | Scope | Effort | Gate |
|---|---|---|---|
| **AUR-276** | Session-correlation telemetry. Correlator + V3 schema + `session_link_candidates` table + dev-only TUI badge. **No API field, no React UI.** | ~1–1.5 hr | None — ships into v1.0 |
| **AUR-277** | Stitched-sessions UI. `/api/sessions/:id` link field + React sidebar block. Optional hedge UI + thumbs-up/down feedback if FP is in the 5–15% band. | ~2–3 hr | Blocked: AUR-276 done **+** ≥10 candidate pairs accumulated in self-use **+** Michael manually classifies them **+** measured FP <15% (or redesign) |

## Why split, not just shrink

- The original plan's correlator + schema work is reusable as-is — it produces candidate pairs either way.
- The cancelled AUR-183 explicitly said "revisit in v1.1 once v1.0 is out." Shipping unobserved UI in v1.0 ignores that call. Shipping silent telemetry in v1.0 *enables* it.
- 1 hr of telemetry now buys honest measurement before any UI commitment. Asymmetric: small cost, big optionality.

## What carries forward from the old PROGRESS.md plan

The architecture sections of the original plan are still correct and reusable inside AUR-276:

- §3.1 Data flow (sink wrapper composition).
- §3.2 Key types (`RecentWriteEntry`, but rename `SessionLink` → `SessionLinkCandidate`).
- §3.3 Schema migration `applyV3` — but rename table `session_links` → `session_link_candidates`.
- §3.4 Workspace + branch resolution (lazy 60-s branch cache; null-gate semantics).
- §3.5 Failure scenarios.
- §4 Code-quality decisions (especially: keep `recent-writes.ts` as-is, new `src/correlate/` dir, swallow-error parity with `wrapSinkWithStore`).
- §5 Test coverage diagram (drop the React + API rows; everything else applies).
- §10 Worktree parallelization (Lane A store + Lane B correlator unchanged).

## What changes from the old plan

- Drop API-route work (was step 4) → moves to AUR-277.
- Drop React Session-view sidebar (was step 5) → moves to AUR-277.
- Drop integration test that asserts the API returns links → AUR-277.
- Add: dev-only TUI candidate-count badge (env-var gated, e.g. `AGENTWATCH_DEBUG_LINKS=1`).
- Add: a one-shot CLI like `agentwatch link-candidates --session <id>` (or just `--all`) so Michael can dump candidates to manually classify them. JSON output, no formatting.

## Pre-coding assumption to verify (carried forward)

Spot-check from earlier today: top-level lines of recent Claude JSONL in this very repo's project dir reported `(no cwd)`. The plan assumed `obj.cwd` is reliably present. **Before coding AUR-276,** sample 5–10 recent JSONL files and confirm which line shapes carry `cwd`. If only `session_start`-shaped lines do, the correlator must capture cwd at that line and reuse it for downstream `file_write` events on that session — which is fine, but worth verifying first.

## Linear cross-links

- **AUR-115** — moved to Backlog, labels `ai-refinement, blocked`, related to AUR-183/276/277. Description rewritten to point here.
- **AUR-183** — cancelled 2026-04-15. The reason this split exists.
- **AUR-276** — telemetry, v1.0, ~1–1.5 hr.
- **AUR-277** — UI, v1.1, blocked on AUR-276 + validation gate.

## Next step

Nothing to code yet. When Michael decides to start AUR-276:

1. `git checkout main && git pull`
2. `git checkout -b misha/aur-276-session-correlation-telemetry`
3. Update Linear AUR-276 → In Progress, kickoff comment linking this PROGRESS.md.
4. Execute Lane A (store + V3 migration) and Lane B (correlator + branch cache) in parallel worktrees per the original plan §10.
5. Wire up Step 3 (sink wrapper + `details.cwd` in adapters).
6. Skip the old Step 4 + Step 5 — those are AUR-277.
7. Add: dev-only TUI badge + `agentwatch link-candidates` CLI.
8. PR per repo convention (no Claude footer).
9. After ship: this PROGRESS.md is rotated to `~/IdeaProjects/knowledge-base/decisions/2026-05-04-agentwatch-session-correlation-split.md` (short ADR).

The current branch `agent/aur-218-sandbox-docker` is unrelated to this work — it carries the AUR-218 commit (`c2ff389`). PROGRESS.md sits on this branch only because it's where today's planning happened; it should follow into the next branch via `git checkout -b ... && git add PROGRESS.md` or be committed here first depending on Michael's preference.
