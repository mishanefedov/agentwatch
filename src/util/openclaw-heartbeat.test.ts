import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverHeartbeatFiles,
  readHeartbeatFile,
} from "./openclaw-heartbeat.js";

function writeHeartbeat(content: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ohb-"));
  const dir = path.join(tmp, "workspace-test");
  fs.mkdirSync(dir);
  const file = path.join(dir, "HEARTBEAT.md");
  fs.writeFileSync(file, content);
  return file;
}

describe("readHeartbeatFile", () => {
  it("reports empty for the literal template file (comments only)", () => {
    const file = writeHeartbeat(
      "# HEARTBEAT.md Template\n\n```\n# Keep this file empty (or with only comments) to skip heartbeat API calls.\n```\n",
    );
    const status = readHeartbeatFile(file)!;
    expect(status.empty).toBe(true);
    expect(status.tasks).toHaveLength(0);
  });

  it("parses a `## tasks` block of bullet items", () => {
    const file = writeHeartbeat(
      "# Workspace heartbeat\n\n## tasks\n- Check email inbox\n- Summarise yesterday's commits\n- Tidy ~/Downloads\n",
    );
    const status = readHeartbeatFile(file)!;
    expect(status.empty).toBe(false);
    expect(status.tasks.map((t) => t.text)).toEqual([
      "Check email inbox",
      "Summarise yesterday's commits",
      "Tidy ~/Downloads",
    ]);
  });

  it("falls back to the first non-empty paragraph when no tasks block exists", () => {
    const file = writeHeartbeat(
      "# Some heartbeat\n\nKeep an eye on the build pipeline\n",
    );
    const status = readHeartbeatFile(file)!;
    expect(status.tasks).toHaveLength(1);
    expect(status.tasks[0]!.text).toBe("Keep an eye on the build pipeline");
  });

  it("returns null when the file doesn't exist", () => {
    expect(readHeartbeatFile("/tmp/no-such-heartbeat.md")).toBeNull();
  });
});

describe("discoverHeartbeatFiles", () => {
  it("finds HEARTBEAT.md inside every ~/.openclaw/workspace-* dir", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ohbhome-"));
    fs.mkdirSync(path.join(home, ".openclaw", "workspace-main"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(home, ".openclaw", "workspace-main", "HEARTBEAT.md"),
      "# main\n",
    );
    fs.mkdirSync(path.join(home, ".openclaw", "workspace-research"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(home, ".openclaw", "workspace-research", "HEARTBEAT.md"),
      "# research\n",
    );
    // sibling that should be ignored
    fs.mkdirSync(path.join(home, ".openclaw", "agents"), { recursive: true });

    const files = discoverHeartbeatFiles(home);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith("/HEARTBEAT.md"))).toBe(true);
    fs.rmSync(home, { recursive: true });
  });
});
