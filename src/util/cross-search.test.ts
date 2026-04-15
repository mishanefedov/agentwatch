import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchAllSessions } from "./cross-search.js";

describe("searchAllSessions", () => {
  it("returns empty for empty query without touching disk", () => {
    expect(searchAllSessions("")).toEqual([]);
  });

  it("finds hits in Claude-style session files under a fake home", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cross-search-"));
    const claudeDir = path.join(
      tmp,
      ".claude",
      "projects",
      "-Users-me-IdeaProjects-myproj",
    );
    fs.mkdirSync(claudeDir, { recursive: true });
    const session = path.join(claudeDir, "abc123.jsonl");
    fs.writeFileSync(
      session,
      [
        '{"type":"user","content":"hello needle"}',
        '{"type":"assistant","content":"unrelated"}',
        '{"type":"user","content":"another needle line"}',
      ].join("\n"),
    );

    const hits = searchAllSessions("needle", 10, tmp);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]!.agent).toBe("claude-code");
    expect(hits[0]!.sessionId).toBe("abc123");
    expect(hits[0]!.project).toBe("myproj");
    expect(hits[0]!.line).toContain("needle");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("respects the limit argument", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cross-search-lim-"));
    const dir = path.join(tmp, ".claude", "projects", "-a");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "s.jsonl"),
      Array.from({ length: 20 }, () => "needle").join("\n"),
    );
    const hits = searchAllSessions("needle", 5, tmp);
    expect(hits).toHaveLength(5);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
