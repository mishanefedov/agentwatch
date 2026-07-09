import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { startCursorAdapter } from "./cursor.js";
import type { AgentEvent } from "../schema.js";

// Mirrors VS Code / Cursor's real ItemTable shape: a single key/value
// table where `value` holds a JSON blob per key.
const ITEM_TABLE_SCHEMA = `
CREATE TABLE ItemTable (
  key TEXT UNIQUE ON CONFLICT REPLACE,
  value BLOB
);
`;

function seedWorkspaceDb(
  dbPath: string,
  opts: { composers?: unknown; prompts?: unknown } = {},
): void {
  const db = new Database(dbPath);
  db.exec(ITEM_TABLE_SCHEMA);
  const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
  if (opts.composers !== undefined) {
    insert.run("composer.composerData", JSON.stringify(opts.composers));
  }
  if (opts.prompts !== undefined) {
    insert.run("aiService.prompts", JSON.stringify(opts.prompts));
  }
  db.close();
}

describe("startCursorAdapter — SQLite activity (integration)", () => {
  let tmpDir: string;
  let storageRoot: string;
  let cursorDir: string;
  let events: AgentEvent[];
  let stop: (() => void) | null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cursor-adapter-"));
    storageRoot = join(tmpDir, "workspaceStorage");
    cursorDir = join(tmpDir, "dot-cursor"); // deliberately absent-by-default
    mkdirSync(storageRoot, { recursive: true });
    process.env.CURSOR_WORKSPACE_STORAGE_DIR = storageRoot;
    process.env.CURSOR_DIR = cursorDir; // does not exist -> installed:false
    events = [];
    stop = null;
  });

  afterEach(() => {
    if (stop) stop();
    delete process.env.CURSOR_WORKSPACE_STORAGE_DIR;
    delete process.env.CURSOR_DIR;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("no-ops when neither ~/.cursor nor any workspaceStorage db exists", () => {
    rmSync(storageRoot, { recursive: true, force: true });
    const result = startCursorAdapter(tmpDir, (e) => events.push(e));
    stop = result.stop;
    expect(result.status.installed).toBe(false);
    expect(events).toEqual([]);
  });

  it("backfills composer sessions + prompts on boot even with no ~/.cursor", () => {
    const wsDir = join(storageRoot, "abc123");
    mkdirSync(wsDir, { recursive: true });
    seedWorkspaceDb(join(wsDir, "state.vscdb"), {
      composers: {
        allComposers: [
          {
            composerId: "composer-1",
            createdAt: 1_700_000_000_000,
            totalLinesAdded: 20,
            totalLinesRemoved: 5,
            isArchived: false,
          },
        ],
      },
      prompts: [{ text: "add a login page", commandType: 4 }, { text: "fix the bug" }],
    });

    const result = startCursorAdapter(tmpDir, (e) => events.push(e));
    stop = result.stop;

    const sessionStarts = events.filter((e) => e.type === "session_start" && e.agent === "cursor");
    const prompts = events.filter((e) => e.type === "prompt" && e.agent === "cursor");

    expect(sessionStarts).toHaveLength(1);
    expect(sessionStarts[0]?.sessionId).toBe("composer-1");
    expect(sessionStarts[0]?.details?.linesChanged).toEqual({ added: 20, removed: 5 });

    expect(prompts).toHaveLength(2);
    expect(prompts.map((p) => p.details?.fullText)).toEqual([
      "add a login page",
      "fix the bug",
    ]);
    // Prompts have no native timestamp — anchored to the composer's createdAt.
    for (const p of prompts) {
      expect(p.sessionId).toBe("composer-1");
      expect(p.ts).toBe(new Date(1_700_000_000_000).toISOString());
    }
  });

  it("skips prompt events (but still emits composer sessions) when there are no composers to anchor to", () => {
    const wsDir = join(storageRoot, "no-composer");
    mkdirSync(wsDir, { recursive: true });
    seedWorkspaceDb(join(wsDir, "state.vscdb"), {
      prompts: [{ text: "orphan prompt" }],
    });

    const result = startCursorAdapter(tmpDir, (e) => events.push(e));
    stop = result.stop;

    expect(events.filter((e) => e.type === "prompt")).toEqual([]);
    expect(events.filter((e) => e.type === "session_start")).toEqual([]);
  });

  it("aggregates across multiple workspaceStorage directories", () => {
    const ws1 = join(storageRoot, "ws1");
    const ws2 = join(storageRoot, "ws2");
    mkdirSync(ws1, { recursive: true });
    mkdirSync(ws2, { recursive: true });
    seedWorkspaceDb(join(ws1, "state.vscdb"), {
      composers: { allComposers: [{ composerId: "ws1-composer", createdAt: 1_700_000_000_000 }] },
    });
    seedWorkspaceDb(join(ws2, "state.vscdb"), {
      composers: { allComposers: [{ composerId: "ws2-composer", createdAt: 1_700_000_100_000 }] },
    });

    const result = startCursorAdapter(tmpDir, (e) => events.push(e));
    stop = result.stop;

    const ids = events
      .filter((e) => e.type === "session_start")
      .map((e) => e.sessionId)
      .sort();
    expect(ids).toEqual(["ws1-composer", "ws2-composer"]);
  });

  it("picks up a new composer + prompt appended AFTER the adapter starts", { timeout: 10_000 }, async () => {
    const wsDir = join(storageRoot, "live");
    mkdirSync(wsDir, { recursive: true });
    const dbPath = join(wsDir, "state.vscdb");
    seedWorkspaceDb(dbPath, {
      composers: { allComposers: [{ composerId: "c1", createdAt: 1_700_000_000_000 }] },
      prompts: [{ text: "first prompt" }],
    });

    const result = startCursorAdapter(tmpDir, (e) => events.push(e));
    stop = result.stop;
    events.length = 0;

    const db = new Database(dbPath);
    db.prepare("UPDATE ItemTable SET value = ? WHERE key = 'aiService.prompts'").run(
      JSON.stringify([{ text: "first prompt" }, { text: "second prompt" }]),
    );
    db.close();

    await new Promise((r) => setTimeout(r, 3_000));

    const newPrompt = events.find(
      (e) => e.type === "prompt" && e.details?.fullText === "second prompt",
    );
    expect(newPrompt).toBeDefined();
    expect(newPrompt?.sessionId).toBe("c1");
  });
});
