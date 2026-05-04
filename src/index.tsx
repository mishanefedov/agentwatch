import { render } from "ink";
import { App } from "./ui/App.js";
import { restoreTerminal } from "./util/terminal.js";
import { onShutdown, runShutdownHooks } from "./util/shutdown.js";

const arg = process.argv[2];

/** Enter the terminal's alternate screen buffer so the TUI takes over the
 *  viewport and the shell's scrollback is preserved on exit. Leaving the
 *  alt screen (and restoring raw mode) happens in restoreTerminal(). */
const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";

function enterAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write(ENTER_ALT_SCREEN);
}

if (arg === "--help" || arg === "-h") {
  console.log(`agentwatch — local observability for AI coding agents

Usage:
  agentwatch                launch the TUI + web UI (http://127.0.0.1:3456)
  agentwatch serve          run only the web server (no TUI, for remote boxes)
  agentwatch doctor         detect installed agents and print readiness
  agentwatch mcp            run as an MCP server over stdio
  agentwatch daemon ...     install + manage the background capture service
                              (subcommands: start | stop | status | logs)
  agentwatch hooks ...      install / uninstall / status the Claude Code hooks adapter
  agentwatch prune          drop events older than --older-than-days (default 90)
  agentwatch link-candidates   dump AUR-276 session-correlation candidate pairs as JSON
                               (--session <id> to scope; --limit <n> to cap)
  agentwatch --help         show this help

Flags:
  --no-web                  TUI only, don't start the web server
  --port <n>                web server port (default 3456)
  --host <addr>             web server bind address (default 127.0.0.1)

Hotkeys inside the TUI:
  q       quit
  a       toggle agent panel
  f       cycle agent filter
  p       pause / resume event stream
  c       clear events
  w       open web UI in browser

Environment:
  WORKSPACE_ROOT          override the detected workspace root
  AGENTWATCH_PORT         override the web server port
  AGENTWATCH_HOST         override the web server bind address
  AGENTWATCH_DEBUG_LINKS  show AUR-276 candidate-pair counts in the agent panel
`);
  process.exit(0);
}

if (arg === "mcp") {
  try {
    const { runMcpServer } = await import("./mcp/server.js");
    await runMcpServer();
    await new Promise<void>((resolve) => {
      process.stdin.on("end", resolve);
      process.stdin.on("close", resolve);
    });
  } catch (err) {
    process.stderr.write(`[agentwatch] mcp error: ${String(err)}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (arg === "daemon") {
  const { dispatchDaemon } = await import("./daemon/index.js");
  await dispatchDaemon(process.argv[3]);
  // dispatchDaemon either exits or runs forever; if it returns we're done.
  process.exit(0);
}

if (arg === "hooks") {
  const sub = process.argv[3];
  const {
    installClaudeHooks,
    uninstallClaudeHooks,
    claudeHooksStatus,
  } = await import("./adapters/claude-hooks-install.js");
  if (sub === "install") {
    const port = Number(parseFlag("--port") ?? process.env.AGENTWATCH_PORT ?? "3456");
    const result = installClaudeHooks({ port });
    console.log(`installed agentwatch hooks into ${result.settingsPath}`);
    console.log(`events: ${result.installedEvents.join(", ")}`);
    if (result.alreadyManaged) {
      console.log(`(replaced previously-installed agentwatch stanzas)`);
    }
    process.exit(0);
  }
  if (sub === "uninstall") {
    const result = uninstallClaudeHooks();
    if (result.removedEvents.length === 0) {
      console.log(`no agentwatch hook stanzas found in ${result.settingsPath}`);
    } else {
      console.log(`removed ${result.removedEvents.length} hook stanzas from ${result.settingsPath}`);
      console.log(`events: ${result.removedEvents.join(", ")}`);
    }
    process.exit(0);
  }
  if (sub === "status" || sub === undefined) {
    const status = claudeHooksStatus();
    console.log(`claude hooks: ${status.status}`);
    console.log(`settings: ${status.settingsPath}`);
    if (status.managedEvents.length > 0) {
      console.log(`installed: ${status.managedEvents.join(", ")}`);
    }
    if (status.missingEvents.length > 0) {
      console.log(`missing:   ${status.missingEvents.join(", ")}`);
    }
    process.exit(0);
  }
  process.stderr.write(
    `agentwatch hooks: unknown subcommand "${sub}" (use install | uninstall | status)\n`,
  );
  process.exit(2);
}

if (arg === "link-candidates") {
  // AUR-276: dump session-correlation candidate pairs as JSON so Michael
  // can manually classify them (true-positive / false-positive / unclear)
  // toward the AUR-277 validation gate. No formatting, no colours — this
  // is plumbing, not UX.
  const { openStore } = await import("./store/index.js");
  const sessionId = parseFlag("--session");
  const limitFlag = parseFlag("--limit");
  const limit = limitFlag ? Number(limitFlag) : undefined;
  if (limit != null && (!Number.isFinite(limit) || limit < 1)) {
    process.stderr.write(
      `[agentwatch] link-candidates: --limit must be a positive number, got ${limitFlag}\n`,
    );
    process.exit(2);
  }
  const store = openStore();
  try {
    const rows = store.listSessionLinkCandidates({
      ...(sessionId ? { sessionId } : {}),
      ...(limit ? { limit } : {}),
    });
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
  } finally {
    store.close();
  }
  process.exit(0);
}

if (arg === "prune") {
  const { openStore } = await import("./store/index.js");
  const days = Number(parseFlag("--older-than-days") ?? "90");
  if (!Number.isFinite(days) || days < 0) {
    process.stderr.write(
      `[agentwatch] prune: --older-than-days must be a non-negative number, got ${days}\n`,
    );
    process.exit(2);
  }
  const store = openStore();
  const result = store.prune({ olderThanDays: days });
  const stats = store.stats();
  store.close();
  console.log(
    `pruned ${result.deletedEvents} events / ${result.deletedSessions} sessions older than ${days}d ` +
      `(${stats.events} events / ${stats.sessions} sessions / ${(stats.dbBytes / 1_048_576).toFixed(1)} MB remaining)`,
  );
  process.exit(0);
}

if (arg === "doctor") {
  const { detectAgents } = await import("./adapters/detect.js");
  const { detectWorkspaceRoot } = await import("./util/workspace.js");
  const { claudeHooksStatus } = await import("./adapters/claude-hooks-install.js");
  const agents = detectAgents();
  console.log(`workspace: ${detectWorkspaceRoot()}\n`);
  console.log("agents:");
  for (const a of agents) {
    const mark = a.present ? "●" : "○";
    const status = !a.present
      ? "not detected"
      : a.instrumented
        ? "installed (events captured)"
        : "detected (events not yet captured — help us ship this)";
    console.log(`  ${mark} ${a.label.padEnd(18)} ${status}`);
    if (a.configPath) console.log(`    config: ${a.configPath}`);
  }
  const notInstrumented = agents.filter((a) => a.present && !a.instrumented);
  if (notInstrumented.length > 0) {
    console.log("");
    console.log("Agents detected but not yet instrumented:");
    for (const a of notInstrumented) {
      console.log(`  - ${a.label}`);
    }
  }
  console.log("");
  const hooks = claudeHooksStatus();
  console.log(`claude code hooks: ${hooks.status}`);
  if (hooks.status === "partial") {
    console.log(`  missing: ${hooks.missingEvents.join(", ")}`);
  }
  if (hooks.status !== "installed") {
    console.log(`  install with: agentwatch hooks install`);
  }
  process.exit(0);
}

/** Headless mode — start the web server + adapters but no TUI. Useful for
 *  running on a cloud box and pointing your browser at it over LAN. */
if (arg === "serve") {
  const { startServer } = await import("./server/index.js");
  const { startAllAdapters, stopAllAdapters } = await import(
    "./adapters/registry.js"
  );
  const { detectWorkspaceRoot } = await import("./util/workspace.js");
  const { clampTs } = await import("./schema.js");
  const { openStore, wrapSinkWithStore, wrapSinkWithLinks } = await import(
    "./store/index.js"
  );
  const workspace = detectWorkspaceRoot();
  const host = parseFlag("--host") ?? process.env.AGENTWATCH_HOST ?? "127.0.0.1";
  const port = Number(parseFlag("--port") ?? process.env.AGENTWATCH_PORT ?? 3456);
  const { addEventToServer } = await import("./server/index.js");
  let store: ReturnType<typeof openStore> | null = null;
  try {
    store = openStore();
  } catch (err) {
    process.stderr.write(
      `[agentwatch] event store unavailable: ${String(err)}\n`,
    );
  }
  const server = await startServer({
    host,
    port,
    ...(store ? { store } : {}),
  });
  const innerSink = {
    emit: (e: import("./schema.js").AgentEvent) => {
      e.ts = clampTs(e.ts);
      addEventToServer(server, e);
      server.broadcaster.emitEvent(e);
    },
    enrich: (eventId: string, patch: Partial<import("./schema.js").EventDetails>) => {
      for (const bucket of server.byAgent.values()) {
        const target = bucket.find((x) => x.id === eventId);
        if (target) {
          target.details = { ...(target.details ?? {}), ...patch };
          break;
        }
      }
      server.broadcaster.emitEnrich(eventId, patch);
    },
  };
  const { withClassifier } = await import("./classify/index.js");
  const { withClaudeHookDedup } = await import("./adapters/hooks-dedup.js");
  const persistSink = store ? wrapSinkWithStore(innerSink, store) : innerSink;
  // AUR-276: layered after the store wrapper so the linker sees the
  // already-persisted session row when it upserts workspace + branch.
  const linkedSink = store ? wrapSinkWithLinks(persistSink, store) : persistSink;
  const classifiedSink = withClassifier(linkedSink);
  const sink = withClaudeHookDedup(classifiedSink);
  server.setHookSink(sink);
  const adapters = startAllAdapters(sink, workspace);
  onShutdown(() => stopAllAdapters(adapters));
  onShutdown(() => server.stop());
  if (store) onShutdown(() => store?.close());
  process.stderr.write(`[agentwatch] serving ${server.url}\n`);
  // Signal handling happens at the bottom of this file via the global
  // shutdown-hooks wiring; the serve path just registers its cleanup.
  await new Promise(() => undefined);
}

function parseFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const val = process.argv[idx + 1];
  return val && !val.startsWith("--") ? val : undefined;
}

enterAltScreen();

/** Single shutdown path — restore the terminal, drain every registered
 *  hook (adapters, web server, triggers watcher), then exit. Idempotent:
 *  a second signal mid-drain is swallowed by `runShutdownHooks`. */
let shuttingDown = false;
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  restoreTerminal();
  try {
    await runShutdownHooks();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[agentwatch] shutdown error:", err);
  }
  process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    void shutdown(0);
  });
}
// `exit` fires synchronously and can't await — best-effort terminal reset.
process.on("exit", () => {
  restoreTerminal();
});

if (arg !== "serve") {
  const { waitUntilExit } = render(<App />);
  waitUntilExit()
    .catch(() => {
      // Ink sometimes rejects on Ctrl-C; shutdown handler covers it.
    })
    .finally(() => {
      void shutdown(0);
    });
}
