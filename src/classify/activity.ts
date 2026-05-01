import type { AgentEvent } from "../schema.js";

export type ActivityCategory =
  | "coding"
  | "debugging"
  | "exploration"
  | "planning"
  | "refactor"
  | "testing"
  | "docs"
  | "chat"
  | "config"
  | "review"
  | "devops"
  | "research";

export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  "coding",
  "debugging",
  "exploration",
  "planning",
  "refactor",
  "testing",
  "docs",
  "chat",
  "config",
  "review",
  "devops",
  "research",
];

/** Classify a single event into one of the activity categories.
 *
 *  This is a heuristic ladder: each rule contributes a weighted score
 *  for one category, and the highest-scoring category wins. The
 *  categories are deliberately broad (matching CodeBurn's 13 buckets)
 *  so the resulting pie chart answers "where is my spend going?" not
 *  "what exact thing is the agent doing?"
 *
 *  Heuristics are derived from observable signals only — tool name,
 *  file extension, command verb, and a small keyword set on prompt /
 *  response text. No ML dependency. When no rule fires we fall through
 *  to `chat` (the catch-all bucket for assistant turns with no tool use). */
export function classifyEvent(event: AgentEvent): ActivityCategory {
  const scores = scoreEvent(event);
  let winner: ActivityCategory = "chat";
  let max = 0;
  for (const cat of ACTIVITY_CATEGORIES) {
    const s = scores[cat] ?? 0;
    if (s > max) {
      max = s;
      winner = cat;
    }
  }
  return winner;
}

export function scoreEvent(
  event: AgentEvent,
): Partial<Record<ActivityCategory, number>> {
  const scores: Partial<Record<ActivityCategory, number>> = {};
  const add = (cat: ActivityCategory, n: number): void => {
    scores[cat] = (scores[cat] ?? 0) + n;
  };

  const path = (event.path ?? "").toLowerCase();
  const cmd = (event.cmd ?? "").toLowerCase();
  const tool = (event.tool ?? "").toLowerCase();
  const summary = (event.summary ?? "").toLowerCase();
  const fullText = (event.details?.fullText ?? "").toLowerCase();
  const thinking = (event.details?.thinking ?? "").toLowerCase();
  const toolError = event.details?.toolError === true;
  const text = `${summary} ${fullText} ${thinking}`;

  // ---- File-extension signals ----
  if (event.type === "file_write" || event.type === "file_change") {
    if (isTestPath(path)) add("testing", 8);
    else if (isDocPath(path)) add("docs", 8);
    else if (isConfigPath(path)) add("config", 8);
    else add("coding", 7);
  } else if (event.type === "file_read") {
    if (isTestPath(path)) add("testing", 3);
    else if (isDocPath(path)) add("docs", 3);
    else if (isConfigPath(path)) add("config", 3);
    else add("exploration", 4);
  }

  // ---- Tool signals ----
  if (tool === "edit" || tool === "multiedit" || tool === "write") {
    if (isTestPath(path)) add("testing", 4);
    else if (isDocPath(path)) add("docs", 4);
    else add("coding", 4);
  }
  if (tool === "read") add("exploration", 1);
  if (tool === "grep" || tool === "glob") add("exploration", 3);
  if (tool === "webfetch" || tool === "websearch") add("research", 6);
  if (tool === "task") add("planning", 2);

  // ---- Shell-command signals ----
  if (event.type === "shell_exec" || tool === "bash") {
    if (/(\bnpm test\b|\bvitest\b|\bjest\b|\bpytest\b|\bmocha\b|\bpnpm test\b|\bcargo test\b|\bgo test\b)/.test(cmd)) {
      add("testing", 8);
    }
    if (/(\bdocker\b|\bkubectl\b|\bterraform\b|\bansible\b|\bhelm\b|\baws\b|\bgcloud\b|\bsystemctl\b)/.test(cmd)) {
      add("devops", 7);
    }
    if (/\bgit\s+(diff|status|log|blame|show)/.test(cmd)) add("review", 4);
    if (/\bgit\s+(add|commit|push|merge|rebase|checkout)/.test(cmd)) add("coding", 3);
    if (/\b(eslint|prettier|tsc|typecheck|lint|mypy|pyright)\b/.test(cmd)) add("review", 3);
    if (/\b(make|cargo|npm run|pnpm run|yarn run|bun run)\b/.test(cmd)) add("coding", 2);
    if (toolError) add("debugging", 4);
  }

  // ---- Text signals (prompt + response + thinking content) ----
  if (event.type === "prompt" || event.type === "response") {
    if (/\b(refactor|rename|extract|inline|move|reorganize|restructure)\b/.test(text)) {
      add("refactor", 6);
    }
    if (/\b(error|exception|stack[- ]?trace|traceback|fail(?:ed|ing|ure)?|broken|bug|crash|throws?|undefined is not|cannot read prop|nullpointer)\b/.test(text)) {
      add("debugging", 5);
    }
    if (/\b(test(?:s|ing)?|assert(?:ion)?s?|spec(?:s|tests)?|coverage|mock(?:s|ing)?)\b/.test(text)) {
      add("testing", 3);
    }
    if (/\b(review|audit|check|look at|inspect|verify|critique)\b/.test(text)) {
      add("review", 4);
    }
    if (/\b(plan|approach|step\s\d|first[, ]|then\b|finally\b|let\s+me\s+think|let\s+us|design)\b/.test(text)) {
      add("planning", 2);
    }
    if (/\b(deploy|deployment|release|rollout|pipeline|ci\/cd|production|staging|prod\b)\b/.test(text)) {
      add("devops", 3);
    }
    if (/\b(document(?:ation)?|readme|changelog|docs?\b|comment[s]?|jsdoc|tsdoc|docstring)\b/.test(text)) {
      add("docs", 3);
    }
    if (/\b(config(?:ure|uration)?|settings|environment|env\s+var|toml|yaml|yml|tsconfig|package\.json)\b/.test(text)) {
      add("config", 3);
    }
    if (/\b(research|read about|articles?|paper(s)?|blog\b|reference|literature)\b/.test(text)) {
      add("research", 3);
    }
    if (/\b(what is|how does|how do i|where is|find\b|search\b|locate\b)\b/.test(text)) {
      add("exploration", 2);
    }
  }

  // ---- Thinking-block weight: long thinking dominates planning ----
  const thinkingLen = thinking.length;
  if (thinkingLen > 1500) add("planning", 5);
  else if (thinkingLen > 300) add("planning", 2);

  // ---- Catch-all so chat wins for empty assistant chatter ----
  if (event.type === "prompt" || event.type === "response") {
    if (Object.keys(scores).length === 0) add("chat", 1);
  }

  // Session-scaffolding events shouldn't bias category weight; classify
  // them as chat by convention so they don't poison the pie chart.
  if (event.type === "session_start" || event.type === "session_end") {
    return { chat: 1 };
  }
  if (event.type === "compaction") {
    return { planning: 1 };
  }
  if (event.type === "parse_error") {
    return { chat: 0 };
  }

  return scores;
}

function isTestPath(p: string): boolean {
  if (!p) return false;
  return /(^|\/)(tests?|__tests__|spec)\//.test(p) || /\.(test|spec)\.[a-z0-9]+$/.test(p);
}

function isDocPath(p: string): boolean {
  if (!p) return false;
  if (/\.(md|mdx|rst|adoc|txt)$/.test(p)) return true;
  if (/(^|\/)(docs?|guides?|examples?)\//.test(p)) return true;
  if (/(^|\/)(readme|changelog|contributing|license|security|code_of_conduct)/i.test(p)) {
    return true;
  }
  return false;
}

function isConfigPath(p: string): boolean {
  if (!p) return false;
  if (/\.(json|ya?ml|toml|ini|env|config\.[jt]s|cjs|mjs)$/.test(p)) return true;
  if (/(^|\/)(\.env(?:\..*)?|tsconfig|tsup\.config|vitest\.config|vite\.config|jest\.config|babel\.config|webpack\.config|rollup\.config|prettier\.config|eslint\.config|tailwind\.config|postcss\.config)$/i.test(p)) {
    return true;
  }
  if (/(^|\/)package\.json$/i.test(p)) return true;
  return false;
}
