import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { translateClaudeLine } from "../adapters/claude-code.js";
import { translateCodexLine, codexSessionsDir } from "../adapters/codex.js";
import { translateSession as translateOpenClawSession } from "../adapters/openclaw.js";
import type { AgentEvent } from "../schema.js";
import {
  indexedIds,
  loadEmbedder,
  upsertTurns,
  type IndexTurn,
} from "./semantic-index.js";

/**
 * Walks every session file on disk, groups events into turns
 * (user prompt + following assistant/tool events up to the next
 * prompt), embeds each turn with the local sentence-transformer,
 * and writes to the semantic index.
 *
 * Incremental: already-indexed turn ids are skipped, so calling this
 * repeatedly only embeds new material.
 */

export interface BuildProgress {
  scannedFiles: number;
  queuedTurns: number;
  embeddedTurns: number;
  skippedTurns: number;
}

export async function buildSemanticIndex(opts: {
  onProgress?: (p: BuildProgress) => void;
  signal?: AbortSignal;
}): Promise<BuildProgress> {
  const progress: BuildProgress = {
    scannedFiles: 0,
    queuedTurns: 0,
    embeddedTurns: 0,
    skippedTurns: 0,
  };
  const already = indexedIds();
  const queue: IndexTurn[] = [];
  const home = os.homedir();

  // Collect turns from Claude + Codex session files. Gemini chats are
  // JSON (not JSONL) and use a different shape — indexed via a separate
  // branch below.
  const claudeRoot = path.join(home, ".claude", "projects");
  const codexRoot = codexSessionsDir(home);
  const geminiRoot = path.join(home, ".gemini", "tmp");
  const openclawRoot = path.join(home, ".openclaw", "agents");

  for (const file of walkJsonl(claudeRoot)) {
    if (opts.signal?.aborted) break;
    progress.scannedFiles += 1;
    collectClaudeTurns(file, already, queue);
  }
  for (const file of walkJsonl(codexRoot)) {
    if (opts.signal?.aborted) break;
    progress.scannedFiles += 1;
    collectCodexTurns(file, already, queue);
  }
  for (const file of walkJson(geminiRoot)) {
    if (opts.signal?.aborted) break;
    progress.scannedFiles += 1;
    collectGeminiTurns(file, already, queue);
  }
  for (const file of walkJsonl(openclawRoot)) {
    if (opts.signal?.aborted) break;
    // Only index session files (not logs/config-audit).
    if (!file.includes(path.sep + "sessions" + path.sep)) continue;
    progress.scannedFiles += 1;
    collectOpenClawTurns(file, already, queue);
  }

  progress.queuedTurns = queue.length;
  opts.onProgress?.(progress);

  if (queue.length === 0) return progress;

  const embed = await loadEmbedder();

  // Embed in small batches to keep memory bounded and let the UI tick.
  const BATCH = 32;
  for (let i = 0; i < queue.length; i += BATCH) {
    if (opts.signal?.aborted) break;
    const batch = queue.slice(i, i + BATCH);
    const withEmb: (IndexTurn & { embedding: Float32Array })[] = [];
    for (const turn of batch) {
      const emb = await embed(turn.text.slice(0, 8_000));
      withEmb.push({ ...turn, embedding: new Float32Array(emb) });
    }
    upsertTurns(withEmb);
    progress.embeddedTurns += withEmb.length;
    opts.onProgress?.(progress);
  }

  return progress;
}

// ─── Walkers ────────────────────────────────────────────────────────────

function* walkJsonl(root: string): Generator<string> {
  if (!fs.existsSync(root)) return;
  yield* walkExt(root, ".jsonl");
}

function* walkJson(root: string): Generator<string> {
  if (!fs.existsSync(root)) return;
  yield* walkExt(root, ".json");
}

function* walkExt(dir: string, ext: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkExt(full, ext);
    else if (e.isFile() && e.name.endsWith(ext)) yield full;
  }
}

// ─── Claude + Codex collectors ─────────────────────────────────────────

function collectClaudeTurns(
  file: string,
  already: Set<string>,
  queue: IndexTurn[],
): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const sessionId = path.basename(file, ".jsonl");
  const project = projectFromClaudeFile(file);
  const events: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const ev = translateClaudeLine(obj, sessionId, project);
      if (ev) events.push(ev);
    } catch {
      /* skip malformed */
    }
  }
  groupAndQueue("claude-code", sessionId, project, events, already, queue);
}

function collectCodexTurns(
  file: string,
  already: Set<string>,
  queue: IndexTurn[],
): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const base = path.basename(file, ".jsonl");
  const m = base.match(/rollout-[0-9T:\-.]+-(.+)$/);
  const sessionId = m?.[1] ?? base;
  let project = "";
  const events: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "session_meta") {
        const cwd = obj.payload?.cwd;
        if (typeof cwd === "string") {
          project = cwd.split(path.sep).filter(Boolean).pop() ?? "";
        }
        continue;
      }
      const ev = translateCodexLine(obj, sessionId, project);
      if (ev) events.push(ev);
    } catch {
      /* skip */
    }
  }
  groupAndQueue("codex", sessionId, project, events, already, queue);
}

function groupAndQueue(
  agent: string,
  sessionId: string,
  project: string,
  events: AgentEvent[],
  already: Set<string>,
  queue: IndexTurn[],
): void {
  events.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  let turnIdx = 0;
  let current: { prompt?: string; pieces: string[]; ts: string } | null = null;
  const push = () => {
    if (!current) return;
    turnIdx += 1;
    const id = `${agent}:${sessionId}:${turnIdx}`;
    if (already.has(id)) return;
    const text = [current.prompt, ...current.pieces]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!text) return;
    queue.push({
      id,
      agent,
      sessionId,
      project,
      turnIdx,
      timestamp: current.ts,
      label: (current.prompt ?? current.pieces[0] ?? "").slice(0, 60).replace(/\s+/g, " ").trim(),
      text,
    });
  };
  for (const ev of events) {
    if (ev.type === "prompt") {
      push();
      current = {
        prompt: ev.details?.fullText ?? ev.summary,
        pieces: [],
        ts: ev.ts,
      };
      continue;
    }
    if (!current) current = { pieces: [], ts: ev.ts };
    if (ev.type === "response" && ev.details?.fullText) {
      current.pieces.push(ev.details.fullText);
    } else if (ev.cmd) {
      current.pieces.push(`$ ${ev.cmd}`);
    } else if (ev.details?.toolResult) {
      current.pieces.push(ev.details.toolResult.slice(0, 2000));
    } else if (ev.summary) {
      current.pieces.push(ev.summary);
    }
  }
  push();
}

// ─── OpenClaw collector ────────────────────────────────────────────────

function collectOpenClawTurns(
  file: string,
  already: Set<string>,
  queue: IndexTurn[],
): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const sessionId = path.basename(file, ".jsonl");
  // Path shape: ~/.openclaw/agents/<subAgent>/sessions/<id>.jsonl
  const parts = file.split(path.sep);
  const agentsIdx = parts.lastIndexOf("agents");
  const subAgent = agentsIdx >= 0 ? (parts[agentsIdx + 1] ?? "main") : "main";
  const events: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const ev = translateOpenClawSession(obj, subAgent, sessionId);
      if (ev) events.push(ev);
    } catch {
      /* skip malformed */
    }
  }
  const project = events[0]?.summary?.match(/^\[([^\]]+)\]/)?.[1] ?? subAgent;
  groupAndQueue("openclaw", sessionId, project, events, already, queue);
}

// ─── Gemini collector ──────────────────────────────────────────────────

function collectGeminiTurns(
  file: string,
  already: Set<string>,
  queue: IndexTurn[],
): void {
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
  if (!doc || typeof doc !== "object") return;
  const d = doc as Record<string, unknown>;
  const sessionId =
    typeof d.sessionId === "string" ? d.sessionId : path.basename(file, ".json");
  const project = geminiProjectFromPath(file);
  const messages = Array.isArray(d.messages) ? d.messages : [];
  let turnIdx = 0;
  let pending: { prompt: string; ts: string } | null = null;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;
    const type = typeof msg.type === "string" ? msg.type : "";
    const ts = typeof msg.timestamp === "string" ? msg.timestamp : "";
    const text = extractGeminiText(msg.content);
    if (type === "user") {
      pending = { prompt: text, ts };
      continue;
    }
    if (type === "gemini" && pending) {
      turnIdx += 1;
      const id = `gemini:${sessionId}:${turnIdx}`;
      if (already.has(id)) {
        pending = null;
        continue;
      }
      queue.push({
        id,
        agent: "gemini",
        sessionId,
        project,
        turnIdx,
        timestamp: pending.ts,
        label: pending.prompt.slice(0, 60).replace(/\s+/g, " ").trim(),
        text: `${pending.prompt}\n\n${text}`.slice(0, 16_000),
      });
      pending = null;
    }
  }
}

function extractGeminiText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) =>
      c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
        ? ((c as { text: string }).text)
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

// ─── Small path helpers ────────────────────────────────────────────────

function projectFromClaudeFile(file: string): string {
  const parts = file.split(path.sep);
  const idx = parts.lastIndexOf("projects");
  if (idx >= 0 && parts[idx + 1]) {
    const segs = parts[idx + 1]!.split("-").filter(Boolean);
    return segs[segs.length - 1] ?? parts[idx + 1]!;
  }
  return "";
}

function geminiProjectFromPath(file: string): string {
  const parts = file.split(path.sep);
  const idx = parts.lastIndexOf("tmp");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1]!;
  return "";
}
