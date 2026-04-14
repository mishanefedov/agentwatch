import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import type { AgentEvent } from "../schema.js";

/**
 * Desktop notifications for agentwatch. Fires on a small set of default
 * rules: .env access, dangerous shell commands, tool errors, high token
 * budget. Custom user-defined regex triggers land in AUR-108 (M6).
 */

/** Rate-limit: one notification per rule, per target, per 60s. */
const RATE_MS = 60_000;
const recent = new Map<string, number>();
let notifierDisabled = false;

export function shouldNotify(event: AgentEvent): null | {
  title: string;
  body: string;
} {
  // `.env` access (read or write)
  if (
    (event.type === "file_read" || event.type === "file_write") &&
    event.path &&
    /(^|\/)\.env($|\.)/.test(event.path)
  ) {
    return gate(`env:${event.path}`, {
      title: "⚠ agentwatch — .env access",
      body: `${event.agent} ${event.type} ${event.path}`,
    });
  }

  // SSH / AWS / GnuPG credential paths
  if (
    event.path &&
    /(^|\/)(\.ssh|\.aws|\.gnupg)($|\/)/.test(event.path)
  ) {
    return gate(`creds:${event.path}`, {
      title: "⚠ agentwatch — credential path touched",
      body: `${event.agent} ${event.type} ${event.path}`,
    });
  }

  // Dangerous shell commands
  if (event.type === "shell_exec" && event.cmd) {
    const cmd = event.cmd;
    if (/\brm\s+-rf\b/.test(cmd)) {
      return gate(`rm-rf:${cmd.slice(0, 40)}`, {
        title: "⚠ agentwatch — rm -rf",
        body: `${event.agent}: ${cmd.slice(0, 160)}`,
      });
    }
    if (/\bsudo\b/.test(cmd)) {
      return gate(`sudo:${cmd.slice(0, 40)}`, {
        title: "⚠ agentwatch — sudo",
        body: `${event.agent}: ${cmd.slice(0, 160)}`,
      });
    }
    if (/curl[^|]*\|\s*(sh|bash)/.test(cmd)) {
      return gate(`curl-sh:${cmd.slice(0, 40)}`, {
        title: "⚠ agentwatch — curl | sh",
        body: `${event.agent}: ${cmd.slice(0, 160)}`,
      });
    }
  }

  // Tool errors
  if (event.details?.toolError) {
    const tool = event.tool ?? "tool";
    return gate(`err:${tool}:${event.sessionId ?? ""}`, {
      title: `⚠ agentwatch — ${tool} failed`,
      body: `${event.agent} in ${projectOf(event) ?? "?"}: ${event.summary ?? ""}`.slice(0, 200),
    });
  }

  return null;
}

function gate(key: string, payload: { title: string; body: string }) {
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < RATE_MS) return null;
  recent.set(key, now);
  return payload;
}

function projectOf(event: AgentEvent): string | undefined {
  const m = (event.summary ?? "").match(/^\[([^\]/ ]+)/);
  return m?.[1];
}

/** Fire a desktop notification. Silent no-op if the platform tool is
 *  missing or something is wired up wrong — never crashes the TUI. */
export function notify(title: string, body: string): void {
  if (notifierDisabled) return;
  const os = platform();
  // Ink raw-mode TTY breaks inherited stdio on child processes; always
  // use explicit ignore stdio so the notifier never clobbers our TUI.
  const silentStdio = { stdio: ["ignore", "ignore", "ignore"] as const };
  try {
    if (os === "darwin") {
      const escTitle = title.replace(/"/g, '\\"');
      const escBody = body.replace(/"/g, '\\"');
      spawnSync(
        "osascript",
        ["-e", `display notification "${escBody}" with title "${escTitle}"`],
        silentStdio,
      );
      return;
    }
    if (os === "linux") {
      spawnSync("notify-send", [title, body], silentStdio);
      return;
    }
    if (os === "win32") {
      const msg = `[System.Windows.Forms.MessageBox]::Show('${body.replace(/'/g, "''")}', '${title.replace(/'/g, "''")}')`;
      spawnSync("powershell", ["-Command", msg], silentStdio);
      return;
    }
  } catch {
    // Stifle — disable notifier for the session so we don't spam errors.
    notifierDisabled = true;
  }
}
