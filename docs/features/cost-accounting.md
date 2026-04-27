# Cost with cache-hit accounting

## Contract

**GOAL:** Per-turn USD cost from real usage data, aggregated per agent, session, and project.
**USER_VALUE:** Spot a runaway agent or spend spike before the monthly invoice shows up.
**COUNTERFACTUAL:** Cost stays opaque until the provider invoice; users can't tie spend to a specific session or task.

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

Rate table per model lives in `src/util/cost.ts` (DEFAULT_RATES):
- `claude-opus-4-6`
- `claude-sonnet-4-6`
- `claude-haiku-4-5`
- `gemini-2.5-pro`, `gemini-2.5-flash`
- `gpt-5`, `gpt-5-mini`
- `default` fallback (uses sonnet rates)

### Overriding pricing locally (AUR-216)

Provider rates change between releases. Operators can override the
shipped defaults without rebuilding the CLI by writing a JSON file at
`~/.agentwatch/pricing.json` (or wherever `AGENTWATCH_PRICING_PATH`
points):

```json
{
  "claude-opus-4-6": {
    "input": 15.0,
    "cacheCreate": 18.75,
    "cacheRead": 1.5,
    "output": 75.0
  },
  "my-local-model": {
    "input": 0,
    "cacheCreate": 0,
    "cacheRead": 0,
    "output": 0
  }
}
```

Rules:
- Keys are the **normalized** model name (e.g. `gpt-5` not `gpt-5.4-preview`;
  see `normalizeModel` in `cost.ts`).
- Values are USD per **million** tokens.
- All four fields (`input`, `cacheCreate`, `cacheRead`, `output`) must be
  non-negative numbers — partial entries are dropped (we never silently
  use a stale field).
- Unknown / missing models fall back to `default` from `DEFAULT_RATES`.
- The file is read once at adapter startup. Restart agentwatch to pick
  up edits.
- Set `AGENTWATCH_PRICING_DEBUG=1` to log validation rejections.

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
