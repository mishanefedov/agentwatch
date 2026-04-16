import type { AgentName } from "../schema.js";

/**
 * Detects when an event represents one agent invoking another via the
 * child agent's CLI. Today the most common pattern is Claude Code's
 * `/council`-style flows that spawn `codex exec` and `gemini -p`
 * subprocesses; this util lifts those opaque shell commands into
 * structured agent-to-agent call metadata.
 *
 * Returns `null` for ordinary shell commands. The caller decides what
 * to do with the structured result (typically: enrich the event so the
 * call-graph view and OTel exporter can chain it to the spawned child
 * session — see AUR-200, AUR-201, AUR-202).
 */

export interface AgentCall {
  callee: AgentName;
  prompt?: string;
  kind: "exec" | "chat" | "unknown";
  model?: string;
}

interface PatternRule {
  /** Match on the FIRST argv tokens (after the binary name). */
  binary: RegExp;
  /** Optional sub-command tokens that gate the match. */
  subcommand?: string[];
  callee: AgentName;
  kind: "exec" | "chat" | "unknown";
  /** Function that pulls the prompt from the parsed args. */
  promptFrom?: (args: string[]) => string | undefined;
  /** Function that pulls a model id from the parsed args (e.g. ollama). */
  modelFrom?: (args: string[]) => string | undefined;
}

/** When detecting we ignore the absolute path and look at the basename
 *  — `/usr/local/bin/codex exec foo` should match the same as `codex exec foo`. */
function basename(token: string): string {
  const i = token.lastIndexOf("/");
  return i === -1 ? token : token.slice(i + 1);
}

/** Splits the full command into argv-ish tokens, respecting quotes.
 *  Not a true shell parser — handles the cases we actually see in
 *  agent log cmd strings (single + double quotes, escapes for the
 *  outermost layer). */
export function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i]!;
    if (quote) {
      if (c === "\\" && i + 1 < cmd.length) {
        cur += cmd[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) {
        quote = null;
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === " " || c === "\t") {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur) out.push(cur);
  return out;
}

/** Find the value of `flag` in `args` accepting `-p value`, `--prompt value`,
 *  and `--prompt=value` shapes. */
function flagValue(args: string[], short: string, long?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === short || a === long) {
      return args[i + 1];
    }
    if (long && a.startsWith(long + "=")) {
      return a.slice(long.length + 1);
    }
  }
  return undefined;
}

/** First non-flag positional after the subcommand. Used as a fallback
 *  prompt source when no explicit `-p` flag is present. */
function firstPositional(args: string[]): string | undefined {
  for (const a of args) {
    if (a.startsWith("-")) continue;
    return a;
  }
  return undefined;
}

const RULES: PatternRule[] = [
  // codex exec "<prompt>" — the canonical /council pattern.
  {
    binary: /^codex$/,
    subcommand: ["exec"],
    callee: "codex",
    kind: "exec",
    promptFrom: firstPositional,
  },
  {
    binary: /^codex$/,
    subcommand: ["chat"],
    callee: "codex",
    kind: "chat",
  },
  {
    binary: /^codex$/,
    callee: "codex",
    kind: "unknown",
  },
  // gemini -p "<prompt>" — the gemini CLI's exec mode.
  {
    binary: /^gemini$/,
    callee: "gemini",
    kind: "exec",
    promptFrom: (args) =>
      flagValue(args, "-p", "--prompt") ?? firstPositional(args),
  },
  // claude exec / npx claude — Claude Code's CLI invoked from another agent.
  {
    binary: /^claude$/,
    subcommand: ["exec"],
    callee: "claude-code",
    kind: "exec",
    promptFrom: firstPositional,
  },
  {
    binary: /^claude$/,
    callee: "claude-code",
    kind: "unknown",
  },
  // aider <files-or-prompt> — usually run interactively but exec is possible.
  {
    binary: /^aider$/,
    callee: "aider",
    kind: "unknown",
    promptFrom: (args) => flagValue(args, "-m", "--message"),
  },
  // ollama run <model> [<prompt>]
  // After the subcommand-strip pass, args is `[<model>, <prompt>?, ...flags]`.
  {
    binary: /^ollama$/,
    subcommand: ["run"],
    callee: "unknown",
    kind: "exec",
    modelFrom: (args) => args.find((a) => !a.startsWith("-")),
    promptFrom: (args) => {
      const positional = args.filter((a) => !a.startsWith("-"));
      // First positional is the model; second (if any) is the prompt.
      return positional[1];
    },
  },
];

/** Try to detect an agent CLI invocation in a shell command string.
 *  Returns null when the cmd doesn't look like one we know.
 *
 *  Handles common wrappers — `npx <agent>`, `bunx <agent>`, `pnpm dlx <agent>`,
 *  `nvm exec ... <agent>` — by stripping the wrapper before pattern matching.
 *  Also strips a leading `time` / `nice` / `nohup` / `env <KEY>=<VAL>...`. */
export function detectAgentCall(cmd: string): AgentCall | null {
  if (!cmd || !cmd.trim()) return null;
  const tokens = tokenize(cmd.trim());
  if (tokens.length === 0) return null;
  const stripped = stripWrappers(tokens);
  if (stripped.length === 0) return null;
  const binTok = basename(stripped[0]!);
  const args = stripped.slice(1);

  for (const rule of RULES) {
    if (!rule.binary.test(binTok)) continue;
    let argsForExtract = args;
    if (rule.subcommand && rule.subcommand.length > 0) {
      const subIdx = args.findIndex((a) => !a.startsWith("-"));
      const sub = subIdx >= 0 ? args[subIdx]! : undefined;
      if (!sub || !rule.subcommand.includes(sub)) continue;
      // Strip the matched subcommand so promptFrom / firstPositional
      // don't return the subcommand itself.
      argsForExtract = args.slice(0, subIdx).concat(args.slice(subIdx + 1));
    }
    return {
      callee: rule.callee,
      kind: rule.kind,
      prompt: rule.promptFrom?.(argsForExtract) ?? undefined,
      model: rule.modelFrom?.(argsForExtract) ?? undefined,
    };
  }
  return null;
}

/** Strip leading wrappers like `npx`, `bunx`, `pnpm dlx`, `nvm exec`,
 *  `env FOO=bar`, `time`, `nice`, `nohup`. Keeps everything from the
 *  first non-wrapper token onward. */
function stripWrappers(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length) {
    const t = basename(tokens[i]!);
    if (t === "time" || t === "nice" || t === "nohup") {
      i += 1;
      continue;
    }
    if (t === "env") {
      i += 1;
      while (i < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[i]!)) {
        i += 1;
      }
      continue;
    }
    if (t === "npx" || t === "bunx" || t === "yarn" || t === "tsx") {
      i += 1;
      // Skip `-y` / `--yes` flags some users append to npx.
      while (i < tokens.length && (tokens[i] === "-y" || tokens[i] === "--yes")) {
        i += 1;
      }
      continue;
    }
    if (t === "pnpm") {
      i += 1;
      // Allow `pnpm dlx <pkg>` and `pnpm exec <pkg>`.
      if (tokens[i] === "dlx" || tokens[i] === "exec") {
        i += 1;
      }
      continue;
    }
    if (t === "nvm") {
      i += 1;
      if (tokens[i] === "exec" || tokens[i] === "run" || tokens[i] === "use") {
        i += 1;
        // Skip the optional <node-version> arg.
        if (i < tokens.length && /^[\d.]+$/.test(tokens[i]!)) {
          i += 1;
        }
      }
      continue;
    }
    break;
  }
  return tokens.slice(i);
}
