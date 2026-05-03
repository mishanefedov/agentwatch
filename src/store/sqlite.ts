import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentEvent, AgentName, EventDetails, EventType } from "../schema.js";

export interface SessionSummary {
  sessionId: string;
  agent: AgentName;
  project: string | null;
  firstTs: string;
  lastTs: string;
  eventCount: number;
  costUsd: number;
}

export interface ProjectSummary {
  name: string;
  eventCount: number;
  byAgent: Record<string, number>;
  sessionIds: string[];
  cost: number;
  lastTs: string;
}

export interface FtsHit {
  eventId: string;
  sessionId: string | null;
  agent: AgentName;
  ts: string;
  type: EventType;
  snippet: string;
  rank: number;
}

export interface ListSessionsOptions {
  limit?: number;
  agent?: AgentName;
  project?: string;
  since?: string;
}

export interface ListRecentEventsOptions {
  /** ISO timestamp; only events with ts >= sinceTs are returned. */
  sinceTs?: string;
  /** Hard cap on rows returned. Defaults to 1000, max 50000. */
  limit?: number;
  /** Sort order. "desc" = newest-first (default); "asc" = oldest-first. */
  order?: "asc" | "desc";
}

export interface PruneResult {
  deletedEvents: number;
  deletedSessions: number;
}

export interface StoreStats {
  events: number;
  sessions: number;
  dbBytes: number;
  schemaVersion: number;
}

export interface ActivityBucket {
  category: string;
  eventCount: number;
  costUsd: number;
}

export interface EventStore {
  insert(event: AgentEvent): void;
  insertMany(events: AgentEvent[]): void;
  enrich(eventId: string, patch: Partial<EventDetails>): void;
  hasEvent(eventId: string): boolean;
  getEvent(eventId: string): AgentEvent | null;
  listSessionEvents(sessionId: string): AgentEvent[];
  /** Recent events across every session, primarily for ambient passes
   *  (budget rollups, anomaly histories) that need more than the live
   *  in-memory ring but less than the full event table. */
  listRecentEvents(opts?: ListRecentEventsOptions): AgentEvent[];
  listSessions(opts?: ListSessionsOptions): SessionSummary[];
  listProjects(): ProjectSummary[];
  searchFts(query: string, opts?: { limit?: number }): FtsHit[];
  /** Per-category event count + cost for a single session. */
  activityBySession(sessionId: string): ActivityBucket[];
  /** Per-category event count + cost across every session in a project. */
  activityByProject(projectName: string): ActivityBucket[];
  prune(opts: { olderThanDays: number }): PruneResult;
  stats(): StoreStats;
  close(): void;
}

const SCHEMA_VERSION = 2;

export const DEFAULT_DB_PATH = join(homedir(), ".agentwatch", "events.db");

export function openStore(opts: { dbPath?: string } = {}): EventStore {
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return buildStore(db);
}

function applyMigrations(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`,
  );
  const row = db
    .prepare("SELECT version FROM schema_version LIMIT 1")
    .get() as { version: number } | undefined;
  const current = row?.version ?? 0;
  if (current < 1) applyV1(db);
  if (current < 2) applyV2(db);
  db.prepare(
    "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
  ).run(SCHEMA_VERSION);
}

function applyV2(db: Database.Database): void {
  // AUR-264: per-event activity category. ALTER TABLE adds the column;
  // FTS5 doesn't reference category so the existing triggers stay valid.
  // Idempotent — duplicate-column on a re-applied migration is swallowed.
  try {
    db.exec(`ALTER TABLE events ADD COLUMN category TEXT`);
  } catch (err) {
    if (!String(err).includes("duplicate column name")) throw err;
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_category ON events(category)`);
  } catch {
    // best effort
  }
}

function applyV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      agent TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT,
      cmd TEXT,
      tool TEXT,
      summary TEXT,
      session_id TEXT,
      prompt_id TEXT,
      risk_score INTEGER NOT NULL,
      project TEXT,
      details_json TEXT,
      full_text TEXT,
      thinking TEXT,
      tool_input_json TEXT,
      tool_result TEXT,
      cost_usd REAL,
      model TEXT,
      duration_ms INTEGER,
      tool_error INTEGER,
      sub_agent_id TEXT,
      parent_spawn_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project);

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      project TEXT,
      first_ts TEXT NOT NULL,
      last_ts TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_ts ON sessions(last_ts);

    CREATE TABLE IF NOT EXISTS tool_calls (
      event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      tool TEXT NOT NULL,
      duration_ms INTEGER,
      error INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool);

    CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      full_text, thinking, tool_result, summary,
      content='events',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, full_text, thinking, tool_result, summary)
      VALUES (new.rowid, new.full_text, new.thinking, new.tool_result, new.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, full_text, thinking, tool_result, summary)
      VALUES ('delete', old.rowid, old.full_text, old.thinking, old.tool_result, old.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, full_text, thinking, tool_result, summary)
      VALUES ('delete', old.rowid, old.full_text, old.thinking, old.tool_result, old.summary);
      INSERT INTO events_fts(rowid, full_text, thinking, tool_result, summary)
      VALUES (new.rowid, new.full_text, new.thinking, new.tool_result, new.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS sessions_upsert_on_event_insert
    AFTER INSERT ON events
    WHEN new.session_id IS NOT NULL BEGIN
      INSERT INTO sessions (session_id, agent, project, first_ts, last_ts, event_count, cost_usd)
      VALUES (new.session_id, new.agent, new.project, new.ts, new.ts, 1, COALESCE(new.cost_usd, 0))
      ON CONFLICT(session_id) DO UPDATE SET
        last_ts = CASE WHEN new.ts > last_ts THEN new.ts ELSE last_ts END,
        first_ts = CASE WHEN new.ts < first_ts THEN new.ts ELSE first_ts END,
        event_count = event_count + 1,
        cost_usd = cost_usd + COALESCE(new.cost_usd, 0),
        project = COALESCE(sessions.project, new.project),
        updated_at = strftime('%s','now');
    END;
  `);
}

function buildStore(db: Database.Database): EventStore {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO events (
      id, ts, agent, type, path, cmd, tool, summary,
      session_id, prompt_id, risk_score, project, details_json,
      full_text, thinking, tool_input_json, tool_result,
      cost_usd, model, duration_ms, tool_error,
      sub_agent_id, parent_spawn_id, category
    )
    VALUES (
      @id, @ts, @agent, @type, @path, @cmd, @tool, @summary,
      @session_id, @prompt_id, @risk_score, @project, @details_json,
      @full_text, @thinking, @tool_input_json, @tool_result,
      @cost_usd, @model, @duration_ms, @tool_error,
      @sub_agent_id, @parent_spawn_id, @category
    )
  `);

  const insertToolCallStmt = db.prepare(`
    INSERT OR REPLACE INTO tool_calls (event_id, tool, duration_ms, error)
    VALUES (?, ?, ?, ?)
  `);

  const getStmt = db.prepare(
    `SELECT * FROM events WHERE id = ?`,
  );

  const hasStmt = db.prepare(`SELECT 1 FROM events WHERE id = ?`);

  const sessionEventsStmt = db.prepare(
    `SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC`,
  );

  const insertMany = db.transaction((events: AgentEvent[]) => {
    for (const e of events) doInsert(e);
  });

  function doInsert(event: AgentEvent): void {
    const d = event.details ?? {};
    const project = extractProject(event);
    const params = {
      id: event.id,
      ts: event.ts,
      agent: event.agent,
      type: event.type,
      path: event.path ?? null,
      cmd: event.cmd ?? null,
      tool: event.tool ?? null,
      summary: event.summary ?? null,
      session_id: event.sessionId ?? null,
      prompt_id: event.promptId ?? null,
      risk_score: event.riskScore,
      project,
      details_json: d ? JSON.stringify(d) : null,
      full_text: d.fullText ?? null,
      thinking: d.thinking ?? null,
      tool_input_json: d.toolInput ? JSON.stringify(d.toolInput) : null,
      tool_result: d.toolResult ?? null,
      cost_usd: d.cost ?? null,
      model: d.model ?? null,
      duration_ms: d.durationMs ?? null,
      tool_error: d.toolError == null ? null : d.toolError ? 1 : 0,
      sub_agent_id: d.subAgentId ?? null,
      parent_spawn_id: d.parentSpawnId ?? null,
      category: d.category ?? null,
    };
    const info = insertStmt.run(params);
    if (info.changes > 0 && event.tool) {
      insertToolCallStmt.run(
        event.id,
        event.tool,
        d.durationMs ?? null,
        d.toolError ? 1 : 0,
      );
    }
  }

  const enrichSelectStmt = db.prepare(
    `SELECT details_json, cost_usd FROM events WHERE id = ?`,
  );

  const enrichUpdateStmt = db.prepare(`
    UPDATE events SET
      details_json = @details_json,
      full_text = COALESCE(@full_text, full_text),
      thinking = COALESCE(@thinking, thinking),
      tool_input_json = COALESCE(@tool_input_json, tool_input_json),
      tool_result = COALESCE(@tool_result, tool_result),
      cost_usd = COALESCE(@cost_usd, cost_usd),
      model = COALESCE(@model, model),
      duration_ms = COALESCE(@duration_ms, duration_ms),
      tool_error = COALESCE(@tool_error, tool_error)
    WHERE id = @id
  `);

  const sessionCostBumpStmt = db.prepare(`
    UPDATE sessions SET cost_usd = cost_usd + ?, updated_at = strftime('%s','now')
    WHERE session_id = (SELECT session_id FROM events WHERE id = ?)
  `);

  function doEnrich(eventId: string, patch: Partial<EventDetails>): void {
    const row = enrichSelectStmt.get(eventId) as
      | { details_json: string | null; cost_usd: number | null }
      | undefined;
    if (!row) return;
    const prev = row.details_json ? (JSON.parse(row.details_json) as EventDetails) : {};
    const merged: EventDetails = { ...prev, ...patch };
    enrichUpdateStmt.run({
      id: eventId,
      details_json: JSON.stringify(merged),
      full_text: patch.fullText ?? null,
      thinking: patch.thinking ?? null,
      tool_input_json: patch.toolInput ? JSON.stringify(patch.toolInput) : null,
      tool_result: patch.toolResult ?? null,
      cost_usd: patch.cost ?? null,
      model: patch.model ?? null,
      duration_ms: patch.durationMs ?? null,
      tool_error:
        patch.toolError == null ? null : patch.toolError ? 1 : 0,
    });
    // Cost arrives via enrich for some adapters (toolResult pairing); reflect
    // it in the session aggregate so listSessions stays correct.
    if (patch.cost && patch.cost !== row.cost_usd) {
      const delta = patch.cost - (row.cost_usd ?? 0);
      sessionCostBumpStmt.run(delta, eventId);
    }
    if (patch.durationMs != null || patch.toolError != null) {
      const eventRow = db
        .prepare("SELECT tool FROM events WHERE id = ?")
        .get(eventId) as { tool: string | null } | undefined;
      if (eventRow?.tool) {
        insertToolCallStmt.run(
          eventId,
          eventRow.tool,
          merged.durationMs ?? null,
          merged.toolError ? 1 : 0,
        );
      }
    }
  }

  return {
    insert: doInsert,
    insertMany: (events) => insertMany(events),
    enrich: doEnrich,
    hasEvent(eventId) {
      return Boolean(hasStmt.get(eventId));
    },
    getEvent(eventId) {
      const row = getStmt.get(eventId) as RawEventRow | undefined;
      return row ? rowToEvent(row) : null;
    },
    listSessionEvents(sessionId) {
      const rows = sessionEventsStmt.all(sessionId) as RawEventRow[];
      return rows.map(rowToEvent);
    },
    listRecentEvents(opts = {}) {
      const limit = clamp(opts.limit ?? 1000, 1, 50_000);
      const order = opts.order === "asc" ? "ASC" : "DESC";
      const where: string[] = [];
      const params: unknown[] = [];
      if (opts.sinceTs) {
        where.push("ts >= ?");
        params.push(opts.sinceTs);
      }
      const sql = `
        SELECT * FROM events
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY ts ${order}
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(...params, limit) as RawEventRow[];
      return rows.map(rowToEvent);
    },
    listSessions(opts = {}) {
      const limit = clamp(opts.limit ?? 200, 1, 5000);
      const where: string[] = [];
      const params: unknown[] = [];
      if (opts.agent) {
        where.push("agent = ?");
        params.push(opts.agent);
      }
      if (opts.project) {
        where.push("project = ?");
        params.push(opts.project);
      }
      if (opts.since) {
        where.push("last_ts >= ?");
        params.push(opts.since);
      }
      const sql = `
        SELECT session_id, agent, project, first_ts, last_ts, event_count, cost_usd
        FROM sessions
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY last_ts DESC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(...params, limit) as Array<{
        session_id: string;
        agent: AgentName;
        project: string | null;
        first_ts: string;
        last_ts: string;
        event_count: number;
        cost_usd: number;
      }>;
      return rows.map((r) => ({
        sessionId: r.session_id,
        agent: r.agent,
        project: r.project,
        firstTs: r.first_ts,
        lastTs: r.last_ts,
        eventCount: r.event_count,
        costUsd: r.cost_usd,
      }));
    },
    listProjects() {
      const rows = db
        .prepare(
          `SELECT project, agent, COUNT(*) AS event_count, MAX(ts) AS last_ts,
                  COALESCE(SUM(cost_usd), 0) AS cost_total, session_id
           FROM events
           WHERE project IS NOT NULL
           GROUP BY project, agent, session_id`,
        )
        .all() as Array<{
        project: string;
        agent: AgentName;
        event_count: number;
        last_ts: string;
        cost_total: number;
        session_id: string | null;
      }>;
      const byProject = new Map<string, ProjectSummary>();
      for (const r of rows) {
        let p = byProject.get(r.project);
        if (!p) {
          p = {
            name: r.project,
            eventCount: 0,
            byAgent: {},
            sessionIds: [],
            cost: 0,
            lastTs: r.last_ts,
          };
          byProject.set(r.project, p);
        }
        p.eventCount += r.event_count;
        p.byAgent[r.agent] = (p.byAgent[r.agent] ?? 0) + r.event_count;
        if (r.session_id && !p.sessionIds.includes(r.session_id)) {
          p.sessionIds.push(r.session_id);
        }
        p.cost += r.cost_total ?? 0;
        if (r.last_ts > p.lastTs) p.lastTs = r.last_ts;
      }
      return Array.from(byProject.values()).sort((a, b) =>
        a.lastTs < b.lastTs ? 1 : -1,
      );
    },
    searchFts(query, opts = {}) {
      const limit = clamp(opts.limit ?? 100, 1, 500);
      const safe = sanitizeFtsQuery(query);
      if (!safe) return [];
      const rows = db
        .prepare(
          `SELECT e.id AS id, e.session_id AS session_id, e.agent AS agent,
                  e.ts AS ts, e.type AS type, fts.rank AS rank,
                  snippet(events_fts, -1, '<<', '>>', '…', 16) AS snip
           FROM events_fts AS fts
           JOIN events AS e ON e.rowid = fts.rowid
           WHERE events_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(safe, limit) as Array<{
        id: string;
        session_id: string | null;
        agent: AgentName;
        ts: string;
        type: EventType;
        rank: number;
        snip: string;
      }>;
      return rows.map((r) => ({
        eventId: r.id,
        sessionId: r.session_id,
        agent: r.agent,
        ts: r.ts,
        type: r.type,
        snippet: r.snip,
        rank: r.rank,
      }));
    },
    activityBySession(sessionId) {
      const rows = db
        .prepare(
          `SELECT COALESCE(category, 'chat') AS category,
                  COUNT(*) AS event_count,
                  COALESCE(SUM(cost_usd), 0) AS cost_total
           FROM events
           WHERE session_id = ?
           GROUP BY COALESCE(category, 'chat')`,
        )
        .all(sessionId) as Array<{
        category: string;
        event_count: number;
        cost_total: number;
      }>;
      return rows
        .map((r) => ({
          category: r.category,
          eventCount: r.event_count,
          costUsd: r.cost_total,
        }))
        .sort((a, b) => b.eventCount - a.eventCount);
    },
    activityByProject(projectName) {
      const rows = db
        .prepare(
          `SELECT COALESCE(category, 'chat') AS category,
                  COUNT(*) AS event_count,
                  COALESCE(SUM(cost_usd), 0) AS cost_total
           FROM events
           WHERE project = ?
           GROUP BY COALESCE(category, 'chat')`,
        )
        .all(projectName) as Array<{
        category: string;
        event_count: number;
        cost_total: number;
      }>;
      return rows
        .map((r) => ({
          category: r.category,
          eventCount: r.event_count,
          costUsd: r.cost_total,
        }))
        .sort((a, b) => b.eventCount - a.eventCount);
    },
    prune({ olderThanDays }) {
      const cutoffMs = Date.now() - olderThanDays * 86_400_000;
      const cutoff = new Date(cutoffMs).toISOString();
      const events = db
        .prepare(`DELETE FROM events WHERE ts < ?`)
        .run(cutoff);
      const sessions = db
        .prepare(`DELETE FROM sessions WHERE last_ts < ?`)
        .run(cutoff);
      // VACUUM is expensive; we use incremental_vacuum via auto_vacuum if set,
      // else a one-shot only for non-tiny prunes.
      if (events.changes > 1000) {
        try {
          db.exec("VACUUM");
        } catch {
          // VACUUM in WAL mode may transiently fail under contention; not fatal.
        }
      }
      return {
        deletedEvents: Number(events.changes),
        deletedSessions: Number(sessions.changes),
      };
    },
    stats() {
      const eventCount = (
        db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }
      ).c;
      const sessionCount = (
        db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as {
          c: number;
        }
      ).c;
      const pages = (
        db.prepare("PRAGMA page_count").get() as { page_count: number }
      ).page_count;
      const pageSize = (
        db.prepare("PRAGMA page_size").get() as { page_size: number }
      ).page_size;
      const versionRow = db
        .prepare("SELECT version FROM schema_version LIMIT 1")
        .get() as { version: number } | undefined;
      return {
        events: eventCount,
        sessions: sessionCount,
        dbBytes: pages * pageSize,
        schemaVersion: versionRow?.version ?? 0,
      };
    },
    close() {
      db.close();
    },
  };
}

interface RawEventRow {
  id: string;
  ts: string;
  agent: AgentName;
  type: EventType;
  path: string | null;
  cmd: string | null;
  tool: string | null;
  summary: string | null;
  session_id: string | null;
  prompt_id: string | null;
  risk_score: number;
  project: string | null;
  details_json: string | null;
}

function rowToEvent(row: RawEventRow): AgentEvent {
  const details = row.details_json
    ? (JSON.parse(row.details_json) as EventDetails)
    : undefined;
  return {
    id: row.id,
    ts: row.ts,
    agent: row.agent,
    type: row.type,
    path: row.path ?? undefined,
    cmd: row.cmd ?? undefined,
    tool: row.tool ?? undefined,
    summary: row.summary ?? undefined,
    sessionId: row.session_id ?? undefined,
    promptId: row.prompt_id ?? undefined,
    riskScore: row.risk_score,
    details,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function extractProject(e: AgentEvent): string | null {
  const m = (e.summary ?? "").match(/^\[([^\]/ ]+)/);
  return m ? (m[1] ?? null) : null;
}

// FTS5 reserved characters or stray boolean operators crash the parser.
// Strip everything but word chars + spaces, drop FTS5 keywords that the
// user usually typed incidentally, then OR the remaining tokens for
// search-as-you-type recall. Empty result means no query.
const FTS_KEYWORDS = new Set(["AND", "OR", "NOT", "NEAR"]);

function sanitizeFtsQuery(q: string): string {
  const cleaned = q
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const tokens = cleaned
    .split(" ")
    .filter((t) => t.length > 0 && !FTS_KEYWORDS.has(t.toUpperCase()))
    .map((t) => `"${t}"`);
  if (tokens.length === 0) return "";
  return tokens.join(" OR ");
}
