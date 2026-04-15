import type { AgentEvent } from "../schema.js";

export interface TokenBreakdown {
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
  /** Approximate thinking tokens (text chars / 4). */
  thinking: number;
  /** Approximate tool I/O tokens (toolResult + toolInput chars / 4). */
  toolIO: number;
  /** Approximate user-text tokens (prompt fullText chars / 4). */
  user: number;
  /** Total cost in USD summed across assistant turns. */
  cost: number;
  /** Number of assistant turns contributing to these counts. */
  turns: number;
}

/** Approx char-per-token ratio used for fields we can't measure precisely
 *  (thinking blocks, tool I/O text, raw user prompts). Real tokenizers
 *  would be more accurate, but this is close enough to communicate
 *  relative weight between categories. */
const CHARS_PER_TOKEN = 4;

/** Attribute a session's token footprint across categories. Walks the
 *  events bound to `sessionId` and aggregates from the usage object on
 *  each assistant turn, with approximated categories for anything not
 *  covered by the raw usage. */
export function attributeTokens(
  events: AgentEvent[],
  sessionId: string,
): TokenBreakdown {
  const zero: TokenBreakdown = {
    input: 0,
    cacheCreate: 0,
    cacheRead: 0,
    output: 0,
    thinking: 0,
    toolIO: 0,
    user: 0,
    cost: 0,
    turns: 0,
  };
  for (const e of events) {
    if (e.sessionId !== sessionId) continue;
    const d = e.details;
    if (!d) continue;
    const u = d.usage;
    if (u) {
      zero.input += u.input;
      zero.cacheCreate += u.cacheCreate;
      zero.cacheRead += u.cacheRead;
      zero.output += u.output;
      zero.turns += 1;
    }
    if (d.cost) zero.cost += d.cost;
    if (d.thinking) zero.thinking += approxTokens(d.thinking);
    if (d.toolResult) zero.toolIO += approxTokens(d.toolResult);
    if (d.toolInput) zero.toolIO += approxTokens(JSON.stringify(d.toolInput));
    if (e.type === "prompt" && d.fullText) zero.user += approxTokens(d.fullText);
  }
  return zero;
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function totalTokens(b: TokenBreakdown): number {
  return b.input + b.cacheRead + b.cacheCreate + b.output;
}
