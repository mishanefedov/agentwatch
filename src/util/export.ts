import fs from "node:fs";
import path from "node:path";
import type { AgentEvent, AgentName } from "../schema.js";

export const EXPORT_DIR = "agentwatch-export";

export interface ExportResult {
  mdPath: string;
  jsonPath: string;
}

/** Write both .md and .json files for a session's events and return the paths. */
export function exportSession(
  events: AgentEvent[],
  sessionId: string,
  agent: AgentName,
  cwd: string = process.cwd(),
  now: Date = new Date(),
): ExportResult {
  const outDir = path.join(cwd, EXPORT_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const slug = sessionId.slice(0, 8) || "session";
  const base = `${agent}-${slug}-${stamp}`;
  const mdPath = path.join(outDir, `${base}.md`);
  const jsonPath = path.join(outDir, `${base}.json`);
  fs.writeFileSync(mdPath, sessionToMarkdown(events, sessionId, agent));
  fs.writeFileSync(jsonPath, JSON.stringify(events, null, 2));
  return { mdPath, jsonPath };
}

/** Render a session's events as a human-readable markdown transcript. */
export function sessionToMarkdown(
  events: AgentEvent[],
  sessionId: string,
  agent: AgentName,
): string {
  const ordered = [...events].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const lines: string[] = [];
  lines.push(`# agentwatch session export`);
  lines.push("");
  lines.push(`- **Agent:** ${agent}`);
  lines.push(`- **Session:** \`${sessionId}\``);
  lines.push(`- **Events:** ${ordered.length}`);
  if (ordered.length > 0) {
    lines.push(`- **From:** ${ordered[0]!.ts}`);
    lines.push(`- **To:** ${ordered[ordered.length - 1]!.ts}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const e of ordered) {
    lines.push(...renderEvent(e));
    lines.push("");
  }
  return lines.join("\n");
}

function renderEvent(e: AgentEvent): string[] {
  const out: string[] = [];
  const header = `## ${e.ts} · ${e.type}${e.tool ? ` · ${e.tool}` : ""}`;
  out.push(header);
  if (e.summary) out.push(`*${e.summary}*`);
  const d = e.details ?? {};
  if (e.type === "prompt" && d.fullText) {
    out.push("", "**User:**", "", quote(d.fullText));
  } else if (e.type === "response" && d.fullText) {
    out.push("", "**Assistant:**", "", d.fullText.trim());
  } else if (e.cmd) {
    out.push("", "```sh", e.cmd, "```");
  } else if (e.path && (e.type === "file_read" || e.type === "file_write" || e.type === "file_change")) {
    out.push("", `\`${e.path}\``);
  }
  if (d.thinking) out.push("", "**Thinking:**", "", quote(d.thinking));
  if (d.toolInput) out.push("", "**Input:**", "", fenced(JSON.stringify(d.toolInput, null, 2), "json"));
  if (d.toolResult) {
    const lang = inferLang(e);
    out.push("", d.toolError ? "**Result (error):**" : "**Result:**", "", fenced(d.toolResult, lang));
  }
  if (d.usage) {
    const { input, cacheCreate, cacheRead, output } = d.usage;
    const cost = d.cost ? ` · $${d.cost.toFixed(4)}` : "";
    out.push("", `_tokens: in=${input} cacheCreate=${cacheCreate} cacheRead=${cacheRead} out=${output}${cost}_`);
  }
  return out;
}

function quote(s: string): string {
  return s
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

function fenced(s: string, lang: string): string {
  return "```" + lang + "\n" + s.trimEnd() + "\n```";
}

function inferLang(e: AgentEvent): string {
  if (e.cmd || e.type === "shell_exec") return "sh";
  const p = e.path ?? "";
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx",
    py: "py", rs: "rust", go: "go", java: "java",
    md: "md", json: "json", yml: "yaml", yaml: "yaml",
    sh: "sh", bash: "sh", sql: "sql", toml: "toml",
  };
  return map[ext] ?? "";
}
