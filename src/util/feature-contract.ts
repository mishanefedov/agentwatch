import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface FeatureContract {
  /** Basename without extension, e.g. "search". */
  slug: string;
  /** One-line intent: what does this feature accomplish. */
  goal: string;
  /** Why a user cares. If this is generic ("better UX"), the feature
   *  is bloat and should be killed. */
  userValue: string;
  /** What breaks if this feature is removed. Defines the testable
   *  regression surface. */
  counterfactual: string;
}

const FIELDS = [
  { key: "goal", label: "GOAL" },
  { key: "userValue", label: "USER_VALUE" },
  { key: "counterfactual", label: "COUNTERFACTUAL" },
] as const;

export function parseFeatureContract(
  slug: string,
  markdown: string,
): FeatureContract | { slug: string; missing: string[] } {
  const lines = markdown.split(/\r?\n/);
  const fields: Record<string, string> = {};
  const missing: string[] = [];
  for (const { key, label } of FIELDS) {
    const prefix = `**${label}:**`;
    const hit = lines.find((l) => l.trimStart().startsWith(prefix));
    if (!hit) {
      missing.push(label);
      continue;
    }
    const value = hit.trimStart().slice(prefix.length).trim();
    if (value.length === 0) {
      missing.push(label);
      continue;
    }
    fields[key] = value;
  }
  if (missing.length > 0) return { slug, missing };
  return {
    slug,
    goal: fields.goal!,
    userValue: fields.userValue!,
    counterfactual: fields.counterfactual!,
  };
}

export function readAllFeatureContracts(
  dir: string,
): Array<FeatureContract | { slug: string; missing: string[] }> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files
    .filter((f) => f !== "README.md")
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      const body = readFileSync(join(dir, f), "utf8");
      return parseFeatureContract(slug, body);
    });
}
