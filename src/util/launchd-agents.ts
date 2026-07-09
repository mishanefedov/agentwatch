import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { humanizeMs } from "./openclaw-cron.js";
import { mentionsKnownAgent } from "./agent-mention.js";

/**
 * Read-only discovery of macOS launchd user agents at
 * `~/Library/LaunchAgents/*.plist`.
 *
 * Plists on disk are either XML text or Apple's binary plist format
 * (magic bytes `bplist00`). We parse XML plists in-process (no deps —
 * a minimal tokenizer covers the subset of plist types launchd agents
 * actually use: dict/array/string/integer/real/bool). Binary plists are
 * normalized to XML by shelling out to `plutil -convert xml1 -o -
 * <file>` (read-only; never `-o <file>` in place).
 *
 * Health comes from `launchctl list <label>`: a PID in the output means
 * the job is currently running; `LastExitStatus` is the last exit code
 * recorded for on-demand jobs. A non-zero exit from `launchctl list`
 * (job not loaded / launchd unavailable) is treated as "not loaded",
 * not an error.
 *
 * Everything here is guarded to return [] on non-macOS platforms.
 */

export type ExecFn = (cmd: string, args: string[]) => string;

const realExec: ExecFn = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });

export interface LaunchdAgent {
  label: string;
  path: string;
  program?: string;
  arguments?: string[];
  schedule: string;
  scheduleKind: "calendar" | "interval" | "onload" | "unknown";
  loaded: boolean;
  running: boolean;
  pid?: number;
  lastExitStatus?: number;
  agentTag: boolean;
}

/** List every `*.plist` under `~/Library/LaunchAgents/`. [] on non-macOS
 *  or when the directory doesn't exist. */
export function discoverLaunchAgentFiles(home: string = os.homedir()): string[] {
  if (process.platform !== "darwin") return [];
  const dir = path.join(home, "Library", "LaunchAgents");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".plist"))
    .map((e) => path.join(dir, e.name))
    .sort();
}

const BINARY_PLIST_MAGIC = "bplist00";

/** Read + parse one plist file into a plain object. Shells out to
 *  `plutil -convert xml1 -o -` only when the file is binary-encoded. */
export function readPlistFile(
  file: string,
  exec: ExecFn = realExec,
): Record<string, unknown> | null {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  let xml: string;
  if (buf.subarray(0, 8).toString("utf8") === BINARY_PLIST_MAGIC) {
    try {
      xml = exec("plutil", ["-convert", "xml1", "-o", "-", file]);
    } catch {
      return null;
    }
  } else {
    xml = buf.toString("utf8");
  }
  try {
    return parsePlistXml(xml);
  } catch {
    return null;
  }
}

/** Query `launchctl list <label>` for run health. Treats any non-zero
 *  exit (job not loaded, launchd unreachable) as "not loaded". */
export function getLaunchdHealth(
  label: string,
  exec: ExecFn = realExec,
): { loaded: boolean; running: boolean; pid?: number; lastExitStatus?: number } {
  if (process.platform !== "darwin") return { loaded: false, running: false };
  let out: string;
  try {
    out = exec("launchctl", ["list", label]);
  } catch {
    return { loaded: false, running: false };
  }
  const pidMatch = out.match(/"PID"\s*=\s*(\d+);/);
  const exitMatch = out.match(/"LastExitStatus"\s*=\s*(-?\d+);/);
  const pid = pidMatch ? Number(pidMatch[1]) : undefined;
  return {
    loaded: true,
    running: pid !== undefined,
    pid,
    lastExitStatus: exitMatch ? Number(exitMatch[1]) : undefined,
  };
}

/** Discover + parse every launch agent plist, joined with launchctl
 *  health. Returns [] on non-macOS. */
export function readLaunchdAgents(
  home: string = os.homedir(),
  exec: ExecFn = realExec,
): LaunchdAgent[] {
  if (process.platform !== "darwin") return [];
  const files = discoverLaunchAgentFiles(home);
  const out: LaunchdAgent[] = [];
  for (const file of files) {
    const raw = readPlistFile(file, exec);
    if (!raw) continue;
    const label = typeof raw.Label === "string" ? raw.Label : path.basename(file, ".plist");
    const programArguments = Array.isArray(raw.ProgramArguments)
      ? raw.ProgramArguments.filter((x): x is string => typeof x === "string")
      : undefined;
    const program = typeof raw.Program === "string" ? raw.Program : programArguments?.[0];
    const { schedule, scheduleKind } = describeSchedule(raw);
    const health = getLaunchdHealth(label, exec);
    const mentionText = [program, ...(programArguments ?? [])].filter(Boolean).join(" ");
    out.push({
      label,
      path: file,
      program,
      arguments: programArguments,
      schedule,
      scheduleKind,
      loaded: health.loaded,
      running: health.running,
      pid: health.pid,
      lastExitStatus: health.lastExitStatus,
      agentTag: mentionsKnownAgent(mentionText),
    });
  }
  return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeSchedule(
  raw: Record<string, unknown>,
): { schedule: string; scheduleKind: LaunchdAgent["scheduleKind"] } {
  if (raw.StartCalendarInterval !== undefined) {
    const intervals = Array.isArray(raw.StartCalendarInterval)
      ? raw.StartCalendarInterval
      : [raw.StartCalendarInterval];
    const parts = intervals
      .filter((iv): iv is Record<string, unknown> => !!iv && typeof iv === "object")
      .map(describeCalendarInterval);
    return { schedule: parts.length ? parts.join("; ") : "calendar", scheduleKind: "calendar" };
  }
  if (typeof raw.StartInterval === "number") {
    return { schedule: `every ${humanizeMs(raw.StartInterval * 1000)}`, scheduleKind: "interval" };
  }
  if (raw.RunAtLoad === true) {
    return { schedule: "on load", scheduleKind: "onload" };
  }
  return { schedule: "manual", scheduleKind: "unknown" };
}

function describeCalendarInterval(iv: Record<string, unknown>): string {
  const hour = typeof iv.Hour === "number" ? iv.Hour : undefined;
  const minute = typeof iv.Minute === "number" ? iv.Minute : undefined;
  const weekday = typeof iv.Weekday === "number" ? iv.Weekday : undefined;
  const day = typeof iv.Day === "number" ? iv.Day : undefined;
  const time =
    hour !== undefined || minute !== undefined
      ? `${String(hour ?? 0).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`
      : undefined;
  if (weekday !== undefined) {
    return `weekly on ${WEEKDAYS[weekday] ?? weekday}${time ? ` at ${time}` : ""}`;
  }
  if (day !== undefined) {
    return `monthly on day ${day}${time ? ` at ${time}` : ""}`;
  }
  if (time) return `daily at ${time}`;
  return "calendar";
}

// ---------------------------------------------------------------------------
// Minimal plist XML parser — covers dict/array/string/integer/real/bool,
// which is the full set launchd agent plists use. Not a general XML parser.

interface PlistToken {
  type:
    | "key"
    | "string"
    | "integer"
    | "real"
    | "data"
    | "date"
    | "true"
    | "false"
    | "dict-open"
    | "dict-close"
    | "array-open"
    | "array-close";
  value?: string;
}

const TOKEN_RE =
  /<key>([\s\S]*?)<\/key>|<string>([\s\S]*?)<\/string>|<integer>([\s\S]*?)<\/integer>|<real>([\s\S]*?)<\/real>|<data>([\s\S]*?)<\/data>|<date>([\s\S]*?)<\/date>|<true\s*\/>|<false\s*\/>|<dict>|<\/dict>|<array>|<\/array>/g;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tokenize(xml: string): PlistToken[] {
  const tokens: PlistToken[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(xml))) {
    const full = m[0];
    if (full.startsWith("<key>")) tokens.push({ type: "key", value: decodeXmlEntities(m[1] ?? "") });
    else if (full.startsWith("<string>")) tokens.push({ type: "string", value: decodeXmlEntities(m[2] ?? "") });
    else if (full.startsWith("<integer>")) tokens.push({ type: "integer", value: m[3] });
    else if (full.startsWith("<real>")) tokens.push({ type: "real", value: m[4] });
    else if (full.startsWith("<data>")) tokens.push({ type: "data", value: m[5] });
    else if (full.startsWith("<date>")) tokens.push({ type: "date", value: m[6] });
    else if (full.startsWith("<true")) tokens.push({ type: "true" });
    else if (full.startsWith("<false")) tokens.push({ type: "false" });
    else if (full === "<dict>") tokens.push({ type: "dict-open" });
    else if (full === "</dict>") tokens.push({ type: "dict-close" });
    else if (full === "<array>") tokens.push({ type: "array-open" });
    else if (full === "</array>") tokens.push({ type: "array-close" });
  }
  return tokens;
}

function parseValue(tokens: PlistToken[], i: number): [unknown, number] {
  const t = tokens[i];
  if (!t) return [undefined, i + 1];
  switch (t.type) {
    case "string":
      return [t.value ?? "", i + 1];
    case "integer":
    case "real":
      return [Number(t.value), i + 1];
    case "true":
      return [true, i + 1];
    case "false":
      return [false, i + 1];
    case "data":
    case "date":
      return [t.value ?? "", i + 1];
    case "array-open": {
      const arr: unknown[] = [];
      let j = i + 1;
      while (tokens[j] && tokens[j]!.type !== "array-close") {
        const [v, next] = parseValue(tokens, j);
        arr.push(v);
        j = next;
      }
      return [arr, j + 1];
    }
    case "dict-open": {
      const obj: Record<string, unknown> = {};
      let j = i + 1;
      while (tokens[j] && tokens[j]!.type !== "dict-close") {
        const keyTok = tokens[j]!;
        if (keyTok.type !== "key") {
          j += 1;
          continue;
        }
        const key = keyTok.value ?? "";
        const [v, next] = parseValue(tokens, j + 1);
        obj[key] = v;
        j = next;
      }
      return [obj, j + 1];
    }
    default:
      return [undefined, i + 1];
  }
}

/** Parse plist XML text into a plain object. Exported for tests; also
 *  used internally by `readPlistFile`. */
export function parsePlistXml(xml: string): Record<string, unknown> {
  const tokens = tokenize(xml);
  if (tokens.length === 0 || tokens[0]!.type !== "dict-open") return {};
  const [value] = parseValue(tokens, 0);
  return (value ?? {}) as Record<string, unknown>;
}
