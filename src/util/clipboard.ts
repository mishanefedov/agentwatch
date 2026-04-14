import { spawnSync } from "node:child_process";
import { platform } from "node:os";

export type ClipboardResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Copy text to the system clipboard. Zero-dependency: shells out to the
 *  platform-native tool. Returns {ok:false, reason} if unavailable so the
 *  caller can surface a helpful hint instead of crashing. */
export function copyToClipboard(text: string): ClipboardResult {
  const os = platform();
  try {
    if (os === "darwin") {
      return run("pbcopy", [], text);
    }
    if (os === "linux") {
      // Prefer Wayland, fall back to xclip, then xsel.
      if (commandExists("wl-copy")) return run("wl-copy", [], text);
      if (commandExists("xclip")) return run("xclip", ["-selection", "clipboard"], text);
      if (commandExists("xsel")) return run("xsel", ["--clipboard", "--input"], text);
      return {
        ok: false,
        reason: "install wl-copy / xclip / xsel for clipboard support",
      };
    }
    if (os === "win32") {
      return run("clip", [], text);
    }
    return { ok: false, reason: `clipboard not supported on ${os}` };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

function run(cmd: string, args: string[], input: string): ClipboardResult {
  // Explicit stdio: Ink puts stdin into raw mode so the default fd
  // inheritance can EBADF on spawnSync. Pipe stdin (we're supplying
  // `input`), ignore the child's stdout/stderr entirely.
  const res = spawnSync(cmd, args, {
    input,
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (res.error) return { ok: false, reason: String(res.error) };
  if (res.status !== 0)
    return { ok: false, reason: `${cmd} exited ${res.status}` };
  return { ok: true };
}

function commandExists(cmd: string): boolean {
  const res = spawnSync("sh", ["-c", `command -v ${cmd}`], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return res.status === 0;
}

/** Pick the most-useful text to yank for a given event type. */
export function eventToYankText(
  summary?: string,
  path?: string,
  cmd?: string,
  toolResult?: string,
  fullText?: string,
): string {
  // Priority: tool output > full text > cmd > path > summary
  if (toolResult && toolResult.trim()) return toolResult;
  if (fullText && fullText.trim()) return fullText;
  if (cmd) return cmd;
  if (path) return path;
  return summary ?? "";
}
