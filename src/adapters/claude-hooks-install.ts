import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOOKS_MARKER = "agentwatch-managed";
export const DEFAULT_HOOKS_PORT = 3456;

/** Hooks Claude Code recognises that we want to capture. Anything new
 *  (a future Claude release adding event types) still works because
 *  the receiving server has a generic fallback. */
export const MANAGED_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "Notification",
] as const;

export function settingsPath(home?: string): string {
  return join(home ?? homedir(), ".claude", "settings.json");
}

export function buildHookCommand(port: number, eventName: string): string {
  // -m 1: 1-second timeout so a dead agentwatch never slows Claude
  // -s: silent (no curl progress output)
  // --data-binary @-: pipe stdin verbatim (Claude provides the event JSON)
  // exit 0: never block Claude — observability must not fail-close
  // [agentwatch-managed]: marker so uninstall can identify our stanzas
  return `# [${HOOKS_MARKER}] ${eventName}\ncurl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}/api/hooks/${eventName} > /dev/null 2>&1; exit 0`;
}

interface ClaudeSettings {
  hooks?: Record<
    string,
    Array<{
      matcher?: string;
      hooks?: Array<{ type?: string; command?: string }>;
    }>
  >;
  [k: string]: unknown;
}

export interface InstallResult {
  settingsPath: string;
  installedEvents: string[];
  alreadyManaged: boolean;
}

export function installClaudeHooks(opts: { port?: number; home?: string } = {}): InstallResult {
  const port = opts.port ?? DEFAULT_HOOKS_PORT;
  const path = settingsPath(opts.home);
  mkdirSync(dirname(path), { recursive: true });
  const current = readSettings(path);
  const next: ClaudeSettings = { ...current, hooks: { ...(current.hooks ?? {}) } };

  let alreadyManaged = false;
  for (const event of MANAGED_HOOK_EVENTS) {
    const existing = next.hooks![event] ?? [];
    const ourCommand = buildHookCommand(port, event);
    const filtered = existing.filter(
      (g) => !(g.hooks ?? []).some((h) => (h.command ?? "").includes(`[${HOOKS_MARKER}]`)),
    );
    if (filtered.length !== existing.length) alreadyManaged = true;
    filtered.push({
      matcher: ".*",
      hooks: [{ type: "command", command: ourCommand }],
    });
    next.hooks![event] = filtered;
  }
  writeSettings(path, next);
  return {
    settingsPath: path,
    installedEvents: [...MANAGED_HOOK_EVENTS],
    alreadyManaged,
  };
}

export interface UninstallResult {
  settingsPath: string;
  removedEvents: string[];
}

export function uninstallClaudeHooks(opts: { home?: string } = {}): UninstallResult {
  const path = settingsPath(opts.home);
  if (!existsSync(path)) {
    return { settingsPath: path, removedEvents: [] };
  }
  const current = readSettings(path);
  if (!current.hooks) return { settingsPath: path, removedEvents: [] };
  const removed: string[] = [];
  const nextHooks: NonNullable<ClaudeSettings["hooks"]> = {};
  for (const [event, groups] of Object.entries(current.hooks)) {
    const filtered = groups.filter(
      (g) => !(g.hooks ?? []).some((h) => (h.command ?? "").includes(`[${HOOKS_MARKER}]`)),
    );
    if (filtered.length !== groups.length) removed.push(event);
    if (filtered.length > 0) nextHooks[event] = filtered;
  }
  const next: ClaudeSettings = { ...current, hooks: nextHooks };
  if (Object.keys(nextHooks).length === 0) delete next.hooks;
  writeSettings(path, next);
  return { settingsPath: path, removedEvents: removed };
}

export type HooksInstallStatus = "installed" | "not-installed" | "partial";

export interface HooksStatus {
  status: HooksInstallStatus;
  managedEvents: string[];
  missingEvents: string[];
  settingsPath: string;
}

export function claudeHooksStatus(opts: { home?: string } = {}): HooksStatus {
  const path = settingsPath(opts.home);
  if (!existsSync(path)) {
    return {
      status: "not-installed",
      managedEvents: [],
      missingEvents: [...MANAGED_HOOK_EVENTS],
      settingsPath: path,
    };
  }
  const settings = readSettings(path);
  const managed: string[] = [];
  for (const event of MANAGED_HOOK_EVENTS) {
    const groups = settings.hooks?.[event] ?? [];
    const has = groups.some((g) =>
      (g.hooks ?? []).some((h) => (h.command ?? "").includes(`[${HOOKS_MARKER}]`)),
    );
    if (has) managed.push(event);
  }
  const missing = MANAGED_HOOK_EVENTS.filter((e) => !managed.includes(e));
  const status: HooksInstallStatus =
    managed.length === 0
      ? "not-installed"
      : missing.length === 0
        ? "installed"
        : "partial";
  return { status, managedEvents: managed, missingEvents: missing, settingsPath: path };
}

function readSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeSettings(path: string, value: ClaudeSettings): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
}
