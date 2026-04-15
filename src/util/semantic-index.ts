import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";

/**
 * Local-only semantic + lexical index for agent sessions.
 *
 *   BM25 (SQLite FTS5) ─┐
 *                       ├─ Reciprocal Rank Fusion (k=60) → ranked turns
 *   Vector cosine  ─────┘
 *
 * Embeddings: Xenova/all-MiniLM-L6-v2 (384-dim, ~80 MB download on first
 * run, cached at ~/.agentwatch/models/). Loaded lazily via
 * transformers.js with ONNX-runtime WASM so no native build step is
 * required.
 *
 * Storage: ~/.agentwatch/index.sqlite (FTS5 virtual table + a plain
 * table of Float32Array embeddings stored as BLOB). For the ~10k turn
 * scale of a heavy user, brute-force cosine is under 100ms per query
 * and avoids pulling in sqlite-vec as a native extension.
 */

const DB_DIR = path.join(os.homedir(), ".agentwatch");
const DB_PATH = path.join(DB_DIR, "index.sqlite");
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIM = 384;

let db: DB | null = null;
let embedderPromise: Promise<EmbedFn> | null = null;

type EmbedFn = (text: string) => Promise<Float32Array>;

export interface IndexTurn {
  /** `<agent>:<sessionId>:<turnIdx>` — our unique key for the turn. */
  id: string;
  agent: string;
  sessionId: string;
  project: string;
  turnIdx: number;
  timestamp: string;
  /** Short label for the UI (first ~60 chars of the user prompt). */
  label: string;
  /** Concatenated user+assistant text used for both FTS and embedding. */
  text: string;
}

export interface SearchHit {
  id: string;
  agent: string;
  sessionId: string;
  project: string;
  turnIdx: number;
  timestamp: string;
  label: string;
  /** RRF fused score (higher = better). */
  score: number;
  /** Which sub-search contributed: B = BM25 only, V = vector only, H = both. */
  source: "B" | "V" | "H";
}

function openDb(): DB {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
      id UNINDEXED,
      agent UNINDEXED,
      session UNINDEXED,
      project UNINDEXED,
      turn_idx UNINDEXED,
      timestamp UNINDEXED,
      label UNINDEXED,
      text,
      tokenize = 'porter unicode61'
    );
    CREATE TABLE IF NOT EXISTS turns_vec (
      id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL
    );
  `);
  return db;
}

export function _resetForTest(): void {
  db?.close();
  db = null;
  embedderPromise = null;
}

/** Lazy-load the sentence-embedding model. First call downloads the ONNX
 *  weights (~80 MB) to the transformers.js cache under
 *  ~/.agentwatch/models. Subsequent calls reuse the in-memory pipeline. */
export async function loadEmbedder(): Promise<EmbedFn> {
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    const cacheDir = path.join(DB_DIR, "models");
    fs.mkdirSync(cacheDir, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: {
      pipeline: (
        task: string,
        model: string,
        opts?: unknown,
      ) => Promise<(text: string, opts?: unknown) => Promise<{ data: Float32Array }>>;
      env: Record<string, unknown>;
    } = (await import("@xenova/transformers")) as unknown as {
      pipeline: typeof mod.pipeline;
      env: Record<string, unknown>;
    };
    mod.env.cacheDir = cacheDir;
    mod.env.allowLocalModels = false;
    const extractor = await mod.pipeline("feature-extraction", MODEL_ID);
    return async (text: string): Promise<Float32Array> => {
      const res = await extractor(text, { pooling: "mean", normalize: true });
      return res.data as Float32Array;
    };
  })();
  return embedderPromise;
}

export function hasIndex(): boolean {
  return fs.existsSync(DB_PATH);
}

export function indexStats(): { turns: number; vectors: number } {
  const d = openDb();
  const turns = (d.prepare("SELECT COUNT(*) as n FROM turns_fts").get() as {
    n: number;
  }).n;
  const vectors = (d.prepare("SELECT COUNT(*) as n FROM turns_vec").get() as {
    n: number;
  }).n;
  return { turns, vectors };
}

/** Return the set of turn ids already indexed, so callers can skip them. */
export function indexedIds(): Set<string> {
  const d = openDb();
  const rows = d.prepare("SELECT id FROM turns_fts").all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Insert a batch of turns. Embeddings are computed in the caller so
 *  the indexer can show progress; this function just writes. */
export function upsertTurns(
  rows: (IndexTurn & { embedding: Float32Array })[],
): void {
  const d = openDb();
  const insFts = d.prepare(
    `INSERT INTO turns_fts (id, agent, session, project, turn_idx, timestamp, label, text)
     VALUES (@id, @agent, @sessionId, @project, @turnIdx, @timestamp, @label, @text)`,
  );
  const insVec = d.prepare(
    `INSERT OR REPLACE INTO turns_vec (id, embedding) VALUES (?, ?)`,
  );
  const del = d.prepare(`DELETE FROM turns_fts WHERE id = ?`);
  const tx = d.transaction((batch: typeof rows) => {
    for (const r of batch) {
      del.run(r.id); // FTS5 has no upsert; delete-then-insert
      insFts.run(r);
      insVec.run(r.id, Buffer.from(r.embedding.buffer));
    }
  });
  tx(rows);
}

export interface BmHit {
  id: string;
  rank: number; // 1-based
}

/** Plain BM25 search via FTS5. Returns id + rank. */
export function searchBm25(query: string, limit: number): BmHit[] {
  const d = openDb();
  // Quote the query so FTS5 treats it as a phrase-ish match. Users who
  // want operators can escape with `query:"..."`.
  const fts = quoteForFts(query);
  const rows = d
    .prepare(
      `SELECT id FROM turns_fts WHERE turns_fts MATCH ? ORDER BY bm25(turns_fts) LIMIT ?`,
    )
    .all(fts, limit) as { id: string }[];
  return rows.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

function quoteForFts(q: string): string {
  // Split on whitespace, drop non-alphanumeric, then AND the terms.
  const terms = q
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean);
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t}"`).join(" AND ");
}

/** Plain vector search: brute-force cosine against every stored
 *  embedding. Fine for < ~100k rows on a dev laptop. Returns id + rank. */
export function searchVector(queryVec: Float32Array, limit: number): BmHit[] {
  const d = openDb();
  const rows = d.prepare("SELECT id, embedding FROM turns_vec").all() as {
    id: string;
    embedding: Buffer;
  }[];
  const scored: { id: string; score: number }[] = [];
  for (const r of rows) {
    const vec = new Float32Array(
      r.embedding.buffer,
      r.embedding.byteOffset,
      r.embedding.byteLength / 4,
    );
    if (vec.length !== queryVec.length) continue;
    // Both vectors are L2-normalized by the pipeline so the dot product
    // is the cosine similarity.
    let dot = 0;
    for (let i = 0; i < vec.length; i++) dot += vec[i]! * queryVec[i]!;
    scored.push({ id: r.id, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s, i) => ({ id: s.id, rank: i + 1 }));
}

/** Reciprocal Rank Fusion. k=60 per Cormack et al. 2009. */
export function rrfFuse(
  results: { hits: BmHit[]; weight?: number }[],
  k = 60,
  limit = 50,
): { id: string; score: number; sources: Set<number> }[] {
  const acc = new Map<
    string,
    { id: string; score: number; sources: Set<number> }
  >();
  for (let idx = 0; idx < results.length; idx++) {
    const { hits, weight = 1 } = results[idx]!;
    for (const h of hits) {
      const prev = acc.get(h.id);
      const contrib = weight / (k + h.rank);
      if (prev) {
        prev.score += contrib;
        prev.sources.add(idx);
      } else {
        acc.set(h.id, {
          id: h.id,
          score: contrib,
          sources: new Set([idx]),
        });
      }
    }
  }
  return Array.from(acc.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Fetch the full row data for a set of ids, in the ranking order. */
export function enrichHits(
  ranked: { id: string; score: number; sources: Set<number> }[],
): SearchHit[] {
  if (ranked.length === 0) return [];
  const d = openDb();
  const placeholders = ranked.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT id, agent, session as sessionId, project, turn_idx as turnIdx,
              timestamp, label FROM turns_fts WHERE id IN (${placeholders})`,
    )
    .all(...ranked.map((r) => r.id)) as Record<string, unknown>[];
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) byId.set(r.id as string, r);
  return ranked
    .map((r) => {
      const row = byId.get(r.id);
      if (!row) return null;
      const both = r.sources.has(0) && r.sources.has(1);
      const src: "B" | "V" | "H" = both
        ? "H"
        : r.sources.has(0)
          ? "B"
          : "V";
      return {
        id: r.id,
        agent: row.agent as string,
        sessionId: row.sessionId as string,
        project: row.project as string,
        turnIdx: row.turnIdx as number,
        timestamp: row.timestamp as string,
        label: row.label as string,
        score: r.score,
        source: src,
      } satisfies SearchHit;
    })
    .filter((x): x is SearchHit => x !== null);
}

/** One-shot hybrid search. Caller must have embedded the query. */
export async function searchHybrid(
  query: string,
  queryVec: Float32Array,
  limit: number,
): Promise<SearchHit[]> {
  const bm = searchBm25(query, limit * 2);
  const vec = searchVector(queryVec, limit * 2);
  const fused = rrfFuse([{ hits: bm }, { hits: vec }], 60, limit);
  return enrichHits(fused);
}

/** BM25-only fallback for when the embedder is still loading or was
 *  never initialized. */
export function searchBm25Only(query: string, limit: number): SearchHit[] {
  const bm = searchBm25(query, limit);
  const fused = rrfFuse([{ hits: bm }], 60, limit);
  return enrichHits(fused);
}
