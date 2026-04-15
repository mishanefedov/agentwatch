/** Per-million-token rates in USD. Update when Anthropic changes pricing. */
const RATES: Record<
  string,
  {
    input: number;
    cacheCreate: number;
    cacheRead: number;
    output: number;
  }
> = {
  "claude-opus-4-6": {
    input: 15.0,
    cacheCreate: 18.75,
    cacheRead: 1.5,
    output: 75.0,
  },
  "claude-sonnet-4-6": {
    input: 3.0,
    cacheCreate: 3.75,
    cacheRead: 0.3,
    output: 15.0,
  },
  "claude-haiku-4-5": {
    input: 1.0,
    cacheCreate: 1.25,
    cacheRead: 0.1,
    output: 5.0,
  },
  // Gemini 2.5 Pro — Jan 2026 public rates.
  "gemini-2.5-pro": {
    input: 1.25,
    cacheCreate: 1.25,
    cacheRead: 0.31,
    output: 10.0,
  },
  "gemini-2.5-flash": {
    input: 0.075,
    cacheCreate: 0.075,
    cacheRead: 0.019,
    output: 0.3,
  },
  // Codex (GPT-5.x-class) — public OpenAI pricing, Jan 2026.
  "gpt-5": {
    input: 1.25,
    cacheCreate: 1.25,
    cacheRead: 0.125,
    output: 10.0,
  },
  "gpt-5-mini": {
    input: 0.25,
    cacheCreate: 0.25,
    cacheRead: 0.025,
    output: 2.0,
  },
  // Fallback for unknown / synthetic models
  default: {
    input: 3.0,
    cacheCreate: 3.75,
    cacheRead: 0.3,
    output: 15.0,
  },
};

export interface Usage {
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
}

/** Returns USD cost for a single message's usage object. */
export function costOf(model: string, u: Usage): number {
  const rate = RATES[normalizeModel(model)] ?? RATES.default!;
  return (
    (u.input * rate.input +
      u.cacheCreate * rate.cacheCreate +
      u.cacheRead * rate.cacheRead +
      u.output * rate.output) /
    1_000_000
  );
}

export function formatUSD(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function normalizeModel(model: string): string {
  // e.g. "claude-opus-4-6[1m]" → "claude-opus-4-6"
  // "gpt-5.4" → "gpt-5", "gemini-2.5-pro-preview" → "gemini-2.5-pro"
  const base = model.replace(/\[.*?\]$/, "").toLowerCase();
  if (base.startsWith("gpt-5")) {
    if (base.includes("mini")) return "gpt-5-mini";
    return "gpt-5";
  }
  if (base.startsWith("gemini-2.5")) {
    if (base.includes("flash")) return "gemini-2.5-flash";
    return "gemini-2.5-pro";
  }
  return base;
}

export function parseUsage(obj: unknown): Usage | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const input = typeof o.input_tokens === "number" ? o.input_tokens : 0;
  const cacheCreate =
    typeof o.cache_creation_input_tokens === "number"
      ? o.cache_creation_input_tokens
      : 0;
  const cacheRead =
    typeof o.cache_read_input_tokens === "number"
      ? o.cache_read_input_tokens
      : 0;
  const output = typeof o.output_tokens === "number" ? o.output_tokens : 0;
  if (input + cacheCreate + cacheRead + output === 0) return null;
  return { input, cacheCreate, cacheRead, output };
}
