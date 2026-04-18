import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { startHermesAdapter } from "./hermes.js";
import type { AgentEvent } from "../schema.js";

// Schema mirrors hermes-agent/hermes_state.py verbatim (sessions + messages).
// If hermes changes the schema, this test fails — which is the point.
const HERMES_SCHEMA = `
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    user_id TEXT,
    model TEXT,
    model_config TEXT,
    system_prompt TEXT,
    parent_session_id TEXT,
    started_at REAL NOT NULL,
    ended_at REAL,
    end_reason TEXT,
    message_count INTEGER DEFAULT 0,
    tool_call_count INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    billing_provider TEXT,
    billing_base_url TEXT,
    billing_mode TEXT,
    estimated_cost_usd REAL,
    actual_cost_usd REAL,
    cost_status TEXT,
    cost_source TEXT,
    pricing_version TEXT,
    title TEXT,
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT,
    tool_call_id TEXT,
    tool_calls TEXT,
    tool_name TEXT,
    timestamp REAL NOT NULL,
    token_count INTEGER,
    finish_reason TEXT,
    reasoning TEXT,
    reasoning_details TEXT,
    codex_reasoning_items TEXT
);
`;

describe("startHermesAdapter (integration)", () => {
  let tmpDir: string;
  let dbPath: string;
  let events: AgentEvent[];
  let stop: (() => void) | null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "hermes-adapter-"));
    dbPath = join(tmpDir, "state.db");
    const seed = new Database(dbPath);
    seed.pragma("journal_mode = WAL");
    seed.exec(HERMES_SCHEMA);
    seed.close();

    process.env.HERMES_DB_PATH = dbPath;
    events = [];
    stop = null;
  });

  afterEach(() => {
    if (stop) stop();
    delete process.env.HERMES_DB_PATH;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("no-ops silently when the db file doesn't exist", () => {
    process.env.HERMES_DB_PATH = join(tmpDir, "does-not-exist.db");
    stop = startHermesAdapter((e) => events.push(e));
    expect(events).toEqual([]);
    stop();
    stop = null;
  });

  it("treats pre-existing rows as history and does NOT re-emit on boot", () => {
    // This is the design: the adapter doesn't replay the full DB every restart.
    // bootstrap() seeds lastMessageId=MAX(id) and seenSessionIds from existing sessions.
    const db = new Database(dbPath);
    const now = Date.now() / 1000;
    db.prepare(
      "INSERT INTO sessions (id, source, model, started_at, ended_at) VALUES (?, ?, ?, ?, ?)",
    ).run("s1", "cli", "hermes-3", now, now + 5);
    db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
    ).run("s1", "user", "hello", now);
    db.close();

    stop = startHermesAdapter((e) => events.push(e));

    expect(events).toEqual([]);
  });

  it("picks up a new session + message written AFTER the adapter starts", { timeout: 10_000 }, async () => {
    stop = startHermesAdapter((e) => events.push(e));
    expect(events).toEqual([]);

    const db = new Database(dbPath);
    const now = Date.now() / 1000;
    db.prepare(
      "INSERT INTO sessions (id, source, model, started_at) VALUES (?, ?, ?, ?)",
    ).run("s4", "cli", "hermes-3", now);
    db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
    ).run("s4", "user", "delta message", now + 1);
    db.close();

    // Wait past the 2s safety-net poll.
    await new Promise((r) => setTimeout(r, 3_000));

    const sessionStarts = events.filter((e) => e.type === "session_start" && e.sessionId === "s4");
    const prompts = events.filter((e) => e.type === "prompt" && e.details?.fullText === "delta message");
    expect(sessionStarts.length).toBe(1);
    expect(prompts.length).toBe(1);
  });

  it("emits session_end when a previously-open session transitions to ended_at != null", { timeout: 10_000 }, async () => {
    // Seed an OPEN session before adapter boot (so it's tracked in openSessionIds).
    const seed = new Database(dbPath);
    const now = Date.now() / 1000;
    seed.prepare(
      "INSERT INTO sessions (id, source, model, started_at) VALUES (?, ?, ?, ?)",
    ).run("s-open", "cli", "hermes-3", now);
    seed.close();

    stop = startHermesAdapter((e) => events.push(e));
    expect(events).toEqual([]);

    // Now close the session — simulates hermes finishing it.
    const db = new Database(dbPath);
    db.prepare(
      `UPDATE sessions
         SET ended_at=?, end_reason=?, input_tokens=?, output_tokens=?,
             cache_read_tokens=?, cache_write_tokens=?, actual_cost_usd=?
       WHERE id=?`,
    ).run(now + 10, "normal", 100, 42, 10, 5, 0.001, "s-open");
    db.close();

    await new Promise((r) => setTimeout(r, 3_000));

    const endEvt = events.find((e) => e.type === "session_end" && e.sessionId === "s-open");
    expect(endEvt).toBeDefined();
    expect(endEvt?.details?.usage).toEqual({
      input: 100,
      cacheCreate: 5,
      cacheRead: 10,
      output: 42,
    });
    expect(endEvt?.details?.cost).toBe(0.001);
  });

  it("skips role=tool and role=system messages (no prompt/response emitted)", { timeout: 10_000 }, async () => {
    stop = startHermesAdapter((e) => events.push(e));

    const db = new Database(dbPath);
    const now = Date.now() / 1000;
    db.prepare("INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)").run(
      "s3",
      "cli",
      now,
    );
    db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
    ).run("s3", "system", "you are hermes", now);
    db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
    ).run("s3", "tool", '{"result": "ok"}', now + 1);
    db.close();

    await new Promise((r) => setTimeout(r, 3_000));

    // session_start should fire (s3 is a new session), but NO prompt/response/tool_call.
    expect(events.find((e) => e.type === "session_start" && e.sessionId === "s3")).toBeDefined();
    const msgEvents = events.filter(
      (e) => (e.type === "prompt" || e.type === "response" || e.type === "tool_call") && e.sessionId === "s3",
    );
    expect(msgEvents).toEqual([]);
  });
});
