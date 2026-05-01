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
  agentwatch prune          drop events older than --older-than-days (default 90)
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
  WORKSPACE_ROOT   override the detected workspace root
  AGENTWATCH_PORT  override the web server port
  AGENTWATCH_HOST  override the web server bind address
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
  const { openStore, wrapSinkWithStore } = await import("./store/index.js");
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
  const sink = store ? wrapSinkWithStore(innerSink, store) : innerSink;
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
