import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  parseFeatureContract,
  readAllFeatureContracts,
} from "./feature-contract.js";

/**
 * Feature-gate enforcement. Every doc under docs/features/ is a contract:
 * GOAL, USER_VALUE, COUNTERFACTUAL. Missing any one → CI fails.
 *
 * The council verdict: if USER_VALUE is generic ("better UX") or
 * COUNTERFACTUAL is vacuous ("nothing"), the feature is bloat and
 * should be killed. The format cannot enforce quality — only presence —
 * so treat review as the second gate.
 */

describe("parseFeatureContract", () => {
  it("extracts all three fields", () => {
    const md = `# Search

## Contract

**GOAL:** In-buffer full-text filter over the live timeline.
**USER_VALUE:** Find one event fast in a stream of hundreds.
**COUNTERFACTUAL:** Without it, users scroll manually through 500 rows.

## Rest of doc
`;
    const c = parseFeatureContract("search", md);
    expect(c).toEqual({
      slug: "search",
      goal: "In-buffer full-text filter over the live timeline.",
      userValue: "Find one event fast in a stream of hundreds.",
      counterfactual:
        "Without it, users scroll manually through 500 rows.",
    });
  });

  it("reports every missing field", () => {
    const md = `# Broken

Just prose, no contract.
`;
    const c = parseFeatureContract("broken", md);
    expect(c).toMatchObject({
      slug: "broken",
      missing: expect.arrayContaining(["GOAL", "USER_VALUE", "COUNTERFACTUAL"]),
    });
  });

  it("treats a whitespace-only value as missing", () => {
    const md = `**GOAL:**
**USER_VALUE:** real value.
**COUNTERFACTUAL:** real counterfactual.
`;
    const c = parseFeatureContract("partial", md);
    expect(c).toMatchObject({ slug: "partial", missing: ["GOAL"] });
  });
});

describe("every docs/features/*.md has a contract", () => {
  // This is the actual gate — if a feature doc ships without a contract
  // (or if someone deletes a field), CI fails here.
  const dir = join(process.cwd(), "docs", "features");
  const contracts = readAllFeatureContracts(dir);

  it("finds at least one feature doc", () => {
    expect(contracts.length).toBeGreaterThan(0);
  });

  for (const c of contracts) {
    it(`${c.slug}: contract is complete`, () => {
      if ("missing" in c) {
        throw new Error(
          `docs/features/${c.slug}.md missing: ${c.missing.join(", ")}. ` +
            `Add the contract header (see CONTRIBUTING.md § Feature gate).`,
        );
      }
      expect(c.goal.length).toBeGreaterThan(10);
      expect(c.userValue.length).toBeGreaterThan(10);
      expect(c.counterfactual.length).toBeGreaterThan(10);
    });
  }
});
