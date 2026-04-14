import { render } from "ink";
import { App } from "./ui/App.js";

const arg = process.argv[2];

/** Enter/leave the terminal's alternate screen buffer so the TUI takes
 *  over the viewport and the shell's scrollback is preserved on exit. */
const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";

function enterAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write(ENTER_ALT_SCREEN);
}

function leaveAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write(LEAVE_ALT_SCREEN);
}

if (arg === "--help" || arg === "-h") {
  console.log(`agentwatch — local observability for AI coding agents

Usage:
  agentwatch          launch the TUI
  agentwatch doctor   detect installed agents and print readiness
  agentwatch --help   show this help

Hotkeys inside the TUI:
  q       quit
  a       toggle agent panel
  f       cycle agent filter
  p       pause / resume event stream
  c       clear events

Environment:
  WORKSPACE_ROOT  override the detected workspace root
`);
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
    const status = a.present ? "installed" : "not detected";
    console.log(`  ${mark} ${a.label.padEnd(14)} ${status}`);
    if (a.configPath) console.log(`    config: ${a.configPath}`);
  }
  process.exit(0);
}

enterAltScreen();
for (const sig of ["exit", "SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    leaveAltScreen();
    if (sig !== "exit") process.exit(0);
  });
}

const { waitUntilExit } = render(<App />);
waitUntilExit().finally(() => leaveAltScreen());
