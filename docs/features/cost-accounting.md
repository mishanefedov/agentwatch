# Cost with cache-hit accounting

## What it does

Per-assistant-turn USD cost, computed from the Claude `message.usage`
object. Aggregated per agent, per session, per project.

## How to invoke

Automatic. Visible in three places:
- Agent side panel: per-agent total (yellow)
- Sessions list: per-session cost
- Event detail pane: per-turn breakdown

## Inputs

`parseUsage()` in `src/util/cost.ts` extracts four fields from the
message's `usage` object:
- `input_tokens`
- `cache_creation_input_tokens` (billed at ~125% of input)
- `cache_read_input_tokens` (billed at ~10% of input)
- `output_tokens`

Rate table hardcoded per model in `src/util/cost.ts`:
- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`
- `default` fallback (uses sonnet rates)

`costOf(model, usage)` returns USD as a float. `formatUSD(n)` formats with
adaptive precision:
- n < 0.01 → `$0.0042` (4 decimals)
- n < 1 → `$0.840` (3 decimals)
- n ≥ 1 → `$12.40` (2 decimals)

## Outputs

Stashed on `event.details`:
- `usage` — the raw four-number object
- `cost` — computed float
- `model` — normalized model string

## Failure modes

- **Unknown model.** Falls back to sonnet rates. Displayed cost may be
  inaccurate for that turn but non-zero.
- **Missing `usage` object.** `parseUsage` returns null; no cost stashed.
- **Rate table stale.** Hardcoded quarterly — update in
  `src/util/cost.ts`. Mismatch shows as under/over-estimate.

## Why cache accounting matters

Naive summers that treat `cache_read_input_tokens` at full input rate
are **3–10× wrong** on Claude. A turn that reads 42,335 cached tokens +
439 new cache tokens + 6 pure input tokens + 249 output tokens:
- Naive: `42,335 × $15 / 1M + 249 × $75 / 1M = $0.65`
- Correct: `42,335 × $1.50 / 1M + 439 × $18.75 / 1M + 6 × $15 / 1M + 249 × $75 / 1M = $0.089`

Orders of magnitude matter when budgeting.

## Interactions

- Detail pane breakdown reveals the token split — useful for verifying.
- Budget alarms (v0.5, AUR-109) will use the same totals.
- OTel exporter (v0.5, AUR-110) will include `cost.usd` as a semantic
  attribute.
