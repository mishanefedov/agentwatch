import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { translateHook } from "./claude-hooks.js";
import {
  clearHookDedup,
  markHookSeen,
  toolSignature,
  wasHookSeen,
  withClaudeHookDedup,
} from "./hooks-dedup.js";

describe("hooks-dedup — registry", () => {
  beforeEach(() => clearHookDedup());

  it("reports markSeen + wasSeen within the 5s window", () => {
    expect(wasHookSeen("a")).toBe(false);
    markHookSeen("a");
    expect(wasHookSeen("a")).toBe(true);
  });

  it("expires entries after 5s", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    markHookSeen("b");
    vi.setSystemTime(t0 + 4_000);
    expect(wasHookSeen("b")).toBe(true);
    vi.setSystemTime(t0 + 6_000);
    expect(wasHookSeen("b")).toBe(false);
    vi.useRealTimers();
  });

  it("toolSignature returns null when either field is missing", () => {
    expect(toolSignature("s", undefined)).toBeNull();
    expect(toolSignature(undefined, "t")).toBeNull();
    expect(toolSignature("s", "t")).toBe("s:t");
  });
});

describe("hooks-dedup — withClaudeHookDedup wrapper", () => {
  beforeEach(() => clearHookDedup());

  it("forwards hook events even when their signature is already marked", () => {
    const captured: unknown[] = [];
    const wrapped = withClaudeHookDedup({
      emit: (e) => captured.push(e.id),
      enrich: () => undefined,
    });
    markHookSeen("s1:t1");
    wrapped.emit({
      id: "h",
      ts: "2026-05-01T10:00:00Z",
      agent: "claude-code",
      type: "tool_call",
      riskScore: 1,
      sessionId: "s1",
      details: { source: "hooks", toolUseId: "t1" },
    });
    expect(captured).toEqual(["h"]);
  });

  it("drops a JSONL event when its tool signature was just marked by hooks", () => {
    const captured: unknown[] = [];
    const wrapped = withClaudeHookDedup({
      emit: (e) => captured.push(e.id),
      enrich: () => undefined,
    });
    markHookSeen("s1:t1");
    wrapped.emit({
      id: "j",
      ts: "2026-05-01T10:00:00Z",
      agent: "claude-code",
      type: "tool_call",
      riskScore: 1,
      sessionId: "s1",
      details: { toolUseId: "t1" }, // no source: "hooks"
    });
    expect(captured).toEqual([]); // suppressed
  });

  it("doesn't dedup non-claude-code agents", () => {
    const captured: unknown[] = [];
    const wrapped = withClaudeHookDedup({
      emit: (e) => captured.push(e.id),
      enrich: () => undefined,
    });
    markHookSeen("s1:t1");
    wrapped.emit({
      id: "c",
      ts: "2026-05-01T10:00:00Z",
      agent: "codex",
      type: "tool_call",
      riskScore: 1,
      sessionId: "s1",
      details: { toolUseId: "t1" },
    });
    expect(captured).toEqual(["c"]); // forwarded
  });
});

describe("claude-hooks — translateHook", () => {
  it("translates SessionStart into a session_start event", () => {
    const ev = translateHook("SessionStart", {
      session_id: "abc",
      cwd: "/Users/x/IdeaProjects/auraqu",
      source: "startup",
    });
    expect(ev?.type).toBe("session_start");
    expect(ev?.sessionId).toBe("abc");
    expect(ev?.summary).toContain("[auraqu]");
    expect(ev?.summary).toContain("startup");
    expect(ev?.details?.source).toBe("hooks");
  });

  it("translates UserPromptSubmit into a prompt event with fullText", () => {
    const ev = translateHook("UserPromptSubmit", {
      session_id: "s",
      cwd: "/p",
      prompt: "fix the auth bug",
    });
    expect(ev?.type).toBe("prompt");
    expect(ev?.details?.fullText).toBe("fix the auth bug");
  });

  it("translates PreToolUse Bash into a shell_exec with cmd populated", () => {
    const ev = translateHook("PreToolUse", {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_use_id: "tu_1",
    });
    expect(ev?.type).toBe("shell_exec");
    expect(ev?.cmd).toBe("ls -la");
    expect(ev?.details?.toolUseId).toBe("tu_1");
  });

  it("translates PreToolUse Write into a file_write with path populated", () => {
    const ev = translateHook("PreToolUse", {
      session_id: "s",
      tool_name: "Write",
      tool_input: { file_path: "/repo/src/api.ts" },
    });
    expect(ev?.type).toBe("file_write");
    expect(ev?.path).toBe("/repo/src/api.ts");
  });

  it("translates PostToolUse with tool_response string into toolResult", () => {
    const ev = translateHook("PostToolUse", {
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: "a.ts\nb.ts",
    });
    expect(ev?.type).toBe("tool_call");
    expect(ev?.details?.toolResult).toBe("a.ts\nb.ts");
  });

  it("translates PreCompact / PostCompact into compaction events", () => {
    const pre = translateHook("PreCompact", {
      session_id: "s",
      trigger: "auto",
    });
    expect(pre?.type).toBe("compaction");
    expect(pre?.summary).toContain("auto");
  });

  it("translates Stop into a session_end event", () => {
    const ev = translateHook("Stop", { session_id: "s" });
    expect(ev?.type).toBe("session_end");
  });

  it("translates Notification into a response with message text", () => {
    const ev = translateHook("Notification", {
      session_id: "s",
      message: "Permission required for /etc",
    });
    expect(ev?.type).toBe("response");
    expect(ev?.details?.fullText).toBe("Permission required for /etc");
  });

  it("falls through unknown hook event names into a generic tool_call", () => {
    const ev = translateHook("FutureNewHook", { session_id: "s" });
    expect(ev?.type).toBe("tool_call");
    expect(ev?.tool).toBe("FutureNewHook");
    expect(ev?.summary).toContain("FutureNewHook");
  });
});

let homeDir: string;

describe("claude-hooks-install — settings.json round-trip", () => {
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "agentwatch-hooks-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("installs hook stanzas for every managed event type", async () => {
    const mod = await import("./claude-hooks-install.js");
    const result = mod.installClaudeHooks({ port: 3456, home: homeDir });
    const settings = JSON.parse(readFileSync(result.settingsPath, "utf-8")) as {
      hooks: Record<string, unknown>;
    };
    expect(Object.keys(settings.hooks).sort()).toEqual(
      [...mod.MANAGED_HOOK_EVENTS].sort(),
    );
  });

  it("merges with existing user hooks instead of clobbering them", async () => {
    const mod = await import("./claude-hooks-install.js");
    const settingsFile = join(homeDir, ".claude", "settings.json");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(homeDir, ".claude"), { recursive: true });
    writeFileSync(
      settingsFile,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: ".*", hooks: [{ type: "command", command: "user-script.sh" }] },
          ],
        },
      }),
    );
    mod.installClaudeHooks({ port: 3456, home: homeDir });
    const settings = JSON.parse(readFileSync(settingsFile, "utf-8")) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const preGroups = settings.hooks.PreToolUse ?? [];
    const cmds = preGroups
      .flatMap((g) => g.hooks ?? [])
      .map((h) => h.command ?? "");
    expect(cmds.some((c) => c.includes("user-script.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("agentwatch-managed"))).toBe(true);
  });

  it("uninstall removes our stanzas and leaves user stanzas intact", async () => {
    const mod = await import("./claude-hooks-install.js");
    const settingsFile = join(homeDir, ".claude", "settings.json");
    mod.installClaudeHooks({ port: 3456, home: homeDir });
    const settings = JSON.parse(readFileSync(settingsFile, "utf-8")) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    settings.hooks.PreToolUse?.push({ hooks: [{ command: "user-cmd" }] } as never);
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = mod.uninstallClaudeHooks({ home: homeDir });
    expect(result.removedEvents.length).toBeGreaterThan(0);
    const after = JSON.parse(readFileSync(settingsFile, "utf-8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const userPreserved = (after.hooks?.PreToolUse ?? [])
      .flatMap((g) => g.hooks ?? [])
      .some((h) => (h.command ?? "").includes("user-cmd"));
    expect(userPreserved).toBe(true);
  });

  it("reports status accurately before and after install", async () => {
    const mod = await import("./claude-hooks-install.js");
    expect(mod.claudeHooksStatus({ home: homeDir }).status).toBe("not-installed");
    mod.installClaudeHooks({ port: 3456, home: homeDir });
    expect(mod.claudeHooksStatus({ home: homeDir }).status).toBe("installed");
    mod.uninstallClaudeHooks({ home: homeDir });
    expect(mod.claudeHooksStatus({ home: homeDir }).status).toBe("not-installed");
  });
});
