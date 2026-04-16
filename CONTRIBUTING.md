# Contributing to agentwatch

Thanks for taking a look. agentwatch is in early v0 — most "should we build X?"
answers are in the [roadmap](https://linear.app/auraqu/project/agentwatch-748d6aa1c20a)
(public-readable) or just open an issue and ask.

## What's welcome

- **Bug reports** with repro steps. See `.github/ISSUE_TEMPLATE/bug_report.md`.
- **Adapter requests** — a new AI agent or coding CLI we don't support yet.
  See `.github/ISSUE_TEMPLATE/adapter_request.md`.
- **Small PRs** fixing issues, improving docs, tightening types. I'll merge fast.
- **Dogfood notes.** Open a discussion (not an issue) with "what felt slow /
  confusing / wrong" — I read every one.

## What to pause on

- **Large feature PRs without a prior issue.** The roadmap is opinionated and
  scope is deliberately narrow (local-only, TUI-first, multi-agent). Please
  open an issue first so I can tell you if it's in-scope before you invest
  hours.
- **Integrations that ship data off-machine.** agentwatch is local-only by
  principle. An "upload to …" PR will be closed.

## Feature gate (for new features)

Every user-visible feature needs a contract written *before* the code, and
a test that exercises it *before* it merges. The contract lives at the top
of `docs/features/<name>.md` with three fields:

```markdown
## Contract

**GOAL:** One line. What the feature accomplishes.
**USER_VALUE:** One line. Why a user cares. If this is generic ("better UX"),
the feature is bloat — don't build it.
**COUNTERFACTUAL:** One line. What breaks if this feature is removed. This
defines the testable regression surface.
```

`src/util/feature-contract.test.ts` fails CI if any `docs/features/*.md`
file is missing a field. It can't enforce *quality* of the three fields —
review is the second gate. If `USER_VALUE` could fit any feature or
`COUNTERFACTUAL` is "nothing breaks," that's a kill signal.

For the test side: non-trivial reducer changes should land a test in
`src/ui/state.test.ts`. UI-rendering regressions that aren't reducer-shaped
still fall back to the manual walkthrough in `docs/testing/TEST-SCRIPT.md`.

## Dev setup

```bash
git clone https://github.com/mishanefedov/agentwatch.git
cd agentwatch
npm install
npm run dev        # launches the TUI directly from source
npm test           # runs vitest
npm run typecheck  # strict TS
npm run build      # produces dist/ via tsup
```

Node ≥ 20, macOS / Linux. Windows is intentionally out of scope for v0.

## Code shape

- `src/schema.ts` — canonical `AgentEvent` type. Every adapter emits through
  `EventSink`.
- `src/adapters/` — one file per agent (Claude Code, OpenClaw, Cursor,
  filesystem). Each returns a `stop()` function.
- `src/ui/` — ink-based TUI components.
- `src/util/` — shared helpers (cost, project index, clipboard, notifier,
  workspace detection, permissions parsers).

Every adapter:

- Reads local files read-only
- Never calls the network
- Handles its own watcher errors without crashing the process

## PR checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (includes the feature-contract gate)
- [ ] If the PR adds a user-visible feature: contract block added to
      `docs/features/<name>.md` and a test asserts its `COUNTERFACTUAL`
- [ ] Added a test if the change is non-trivial
- [ ] CHANGELOG.md updated if the change is user-visible
- [ ] Commit message describes *why*, not just *what*

## Communication

- Issues for bug reports + scoped feature requests
- Discussions for "have you considered…" conversations
- Email `misha@auraqu.com` for anything sensitive

## License

By contributing, you agree your contribution is licensed under MIT (same as
the rest of the project).
