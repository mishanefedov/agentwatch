import { highlight as cliHighlight, supportsLanguage } from "cli-highlight";
import type { AgentEvent } from "../schema.js";

/** Map tool/extension to cli-highlight language id. `null` = no highlighting. */
export function inferLang(event: AgentEvent, content?: string): string | null {
  if (event.tool === "Bash" || event.type === "shell_exec" || event.cmd) {
    return "bash";
  }
  const p = event.path ?? "";
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  const byExt: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python",
    rs: "rust", go: "go",
    java: "java", kt: "kotlin", swift: "swift",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp",
    cs: "csharp", rb: "ruby", php: "php",
    md: "markdown", markdown: "markdown",
    json: "json", yml: "yaml", yaml: "yaml", toml: "toml",
    sh: "bash", bash: "bash", zsh: "bash",
    sql: "sql", html: "html", css: "css", scss: "scss",
  };
  if (byExt[ext]) return byExt[ext]!;
  if (content?.trim().startsWith("{") || content?.trim().startsWith("[")) {
    try {
      JSON.parse(content);
      return "json";
    } catch {
      /* not JSON */
    }
  }
  return null;
}

/** Highlight `content` as the given language and return an ANSI-colored
 *  string. Falls back to the original content if the language is unknown
 *  or highlighting fails. */
export function highlight(content: string, lang: string | null): string {
  if (!lang || !supportsLanguage(lang)) return content;
  try {
    return cliHighlight(content, { language: lang, ignoreIllegals: true });
  } catch {
    return content;
  }
}
