import { encode as tokenize } from "gpt-tokenizer";
import type { AgentEvent, AgentName } from "../schema.js";
import { memoryFilesFor } from "./memory-file.js";

export interface TokenBreakdown {
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
  /** Thinking tokens (tokenizer-measured). */
  thinking: number;
  /** Tool I/O tokens (toolResult + toolInput, tokenizer-measured). */
  toolIO: number;
  /** User-text tokens (prompt fullText, tokenizer-measured). */
  user: number;
  /** Tokens for the agent's project memory file(s) (tokenizer-measured).
   *  Source varies per agent: CLAUDE.md, AGENTS.md, GEMINI.md,
   *  .cursorrules, .windsurfrules, CONVENTIONS.md, OPENCLAW.md. */
  memoryFile: number;
  /** Total cost in USD summed across assistant turns. */
  cost: number;
  /** Number of assistant turns contributing to these counts. */
  turns: number;
}

export interface TurnBreakdown {
  turnIdx: number;
  ts: string;
  sessionId: string;
  model?: string;
  /** Tokens in each category for this single turn. */
  user: number;
  thinking: number;
  toolIO: number;
  memoryFile: number;
  input: number;
  cacheRead: number;
  cacheCreate: number;
  output: number;
  cost: number;
}

const memoryCache = new Map<string, number>();

/** Read the agent's memory file(s) (if present) and tokenize once per
 *  (agent, cwd) pair. Used as a per-turn attribution for turns that
 *  include the agent's system memory. */
export function memoryFileTokens(
  agent: AgentName,
  cwd: string = process.cwd(),
): number {
  const key = `${agent}|${cwd}`;
  const hit = memoryCache.get(key);
  if (hit !== undefined) return hit;
  const info = memoryFilesFor(agent, cwd);
  const tokens = info.text ? countTokens(info.text) : 0;
  memoryCache.set(key, tokens);
  return tokens;
}

export function _resetMemoryFileCache(): void {
  memoryCache.clear();
}

/** Real tokenizer. Uses gpt-tokenizer (cl100k_base — OpenAI's vocab);
 *  Claude uses a similar-but-not-identical tokenizer and typically
 *  counts ~5% more tokens. Close enough to communicate relative weight.
 *  The UI labels this as "approximate for Claude" so users know. */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return tokenize(text).length;
  } catch {
    // Tokenizer blew up on some odd input; fall back to char-based.
    return Math.ceil(text.length / 4);
  }
}

/** Legacy approximation; retained for tests asserting the old behaviour
 *  on non-tokenized text. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** One TurnBreakdown per assistant turn in the session, chronologically
 *  ordered. User-text tokens come from the *preceding* prompt event (the
 *  one that triggered this turn). Tool I/O is the sum of toolResult +
 *  toolInput on the turn + any tool events that ran as part of it. */
export function attributeTurns(
  events: AgentEvent[],
  sessionId: string,
  cwd: string = process.cwd(),
): TurnBreakdown[] {
  const inSession = events
    .filter((e) => e.sessionId === sessionId)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const agentName = inSession[0]?.agent ?? "unknown";
  const memoryFile = memoryFileTokens(agentName, cwd);
  const breakdowns: TurnBreakdown[] = [];
  let pendingUserTokens = 0;
  let pendingToolIO = 0;
  let turnIdx = 0;

  for (const e of inSession) {
    if (e.type === "prompt" && e.details?.fullText) {
      pendingUserTokens += countTokens(e.details.fullText);
      continue;
    }
    // Non-assistant tool rows (e.g. file_read echoed from fs-watcher)
    // aren't attributed to a specific turn, so fold their I/O into the
    // next assistant turn.
    const d = e.details;
    if (!d) continue;
    if (d.toolResult) pendingToolIO += countTokens(d.toolResult);
    if (d.toolInput) {
      pendingToolIO += countTokens(JSON.stringify(d.toolInput));
    }
    if (!d.usage) continue;

    turnIdx += 1;
    const thinking = d.thinking ? countTokens(d.thinking) : 0;
    breakdowns.push({
      turnIdx,
      ts: e.ts,
      sessionId,
      model: d.model,
      user: pendingUserTokens,
      thinking,
      toolIO: pendingToolIO,
      memoryFile,
      input: d.usage.input,
      cacheRead: d.usage.cacheRead,
      cacheCreate: d.usage.cacheCreate,
      output: d.usage.output,
      cost: d.cost ?? 0,
    });
    pendingUserTokens = 0;
    pendingToolIO = 0;
  }
  return breakdowns;
}

/** Attribute a session's token footprint across categories. Aggregate
 *  of the per-turn breakdown. */
export function attributeTokens(
  events: AgentEvent[],
  sessionId: string,
  cwd: string = process.cwd(),
): TokenBreakdown {
  const turns = attributeTurns(events, sessionId, cwd);
  const out: TokenBreakdown = {
    input: 0,
    cacheCreate: 0,
    cacheRead: 0,
    output: 0,
    thinking: 0,
    toolIO: 0,
    user: 0,
    memoryFile: 0,
    cost: 0,
    turns: turns.length,
  };
  for (const t of turns) {
    out.input += t.input;
    out.cacheCreate += t.cacheCreate;
    out.cacheRead += t.cacheRead;
    out.output += t.output;
    out.thinking += t.thinking;
    out.toolIO += t.toolIO;
    out.user += t.user;
    out.cost += t.cost;
  }
  // Memory file is a constant overhead — include it once, not per turn.
  out.memoryFile = turns.length > 0 ? turns[0]!.memoryFile : 0;
  return out;
}

export function totalTokens(b: TokenBreakdown): number {
  return b.input + b.cacheRead + b.cacheCreate + b.output;
}
