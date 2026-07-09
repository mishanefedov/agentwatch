import { execFileSync } from "node:child_process";
import { mentionsKnownAgent } from "./agent-mention.js";

/**
 * Read-only discovery of the current user's crontab (`crontab -l`).
 *
 * `crontab -l` exits non-zero (and prints "no crontab for <user>" on
 * stderr) when no crontab is installed — that's treated as an empty
 * list, not an error. We never write to the crontab (`crontab -e` /
 * `crontab <file>` are never invoked here).
 */

export type ExecFn = (cmd: string, args: string[]) => string;

const realExec: ExecFn = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });

export interface CrontabEntry {
  /** Raw schedule field(s), e.g. `23 8 * * *` or `@daily`. */
  schedule: string;
  command: string;
  raw: string;
  agentTag: boolean;
}

const ENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*\s*=/;
// 5 whitespace-separated schedule fields, or an `@keyword` shorthand,
// followed by the command.
const CRON_LINE = /^((?:\S+\s+){4}\S+|@\S+)\s+(.+)$/;

/** Parse `crontab -l` output text into structured entries. Skips
 *  comments (`#`) and env-var assignment lines (`FOO=bar`). */
export function parseCrontab(text: string): CrontabEntry[] {
  const out: CrontabEntry[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (ENV_LINE.test(line)) continue;
    const m = CRON_LINE.exec(line);
    if (!m) continue;
    const schedule = m[1]!;
    const command = m[2]!;
    out.push({ schedule, command, raw: line, agentTag: mentionsKnownAgent(command) });
  }
  return out;
}

/** Read + parse the current user's crontab. Returns [] when there is no
 *  crontab installed, `crontab` isn't available, or the command fails
 *  for any other reason. */
export function readCrontab(exec: ExecFn = realExec): CrontabEntry[] {
  let out: string;
  try {
    out = exec("crontab", ["-l"]);
  } catch {
    return [];
  }
  return parseCrontab(out);
}
