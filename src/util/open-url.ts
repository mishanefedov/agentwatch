import { spawn } from "node:child_process";
import { platform } from "node:os";

/** Open a URL in the user's default browser. Non-blocking, best-effort;
 *  silently no-ops if `open` / `xdg-open` / `start` aren't available. */
export function openUrl(url: string): void {
  try {
    const p = platform();
    if (p === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else if (p === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // intentional no-op
  }
}
