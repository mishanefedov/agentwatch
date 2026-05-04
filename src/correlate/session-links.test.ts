import { describe, expect, it } from "vitest";
import { RecentWritesIndex, WINDOW_MS } from "./session-links.js";

describe("RecentWritesIndex.recordAndQuery", () => {
  it("returns no matches for the very first write of a path", () => {
    const idx = new RecentWritesIndex();
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "claude-code",
      "sess-A",
      1_000,
      "main",
      "/repo",
    );
    expect(matches).toEqual([]);
    expect(idx.entryCount()).toBe(1);
  });

  it("filters out same-session writes (same agent or not)", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", "/repo");
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "claude-code",
      "sess-A",
      2_000,
      "main",
      "/repo",
    );
    expect(matches).toEqual([]);
  });

  it("filters out same-agent / different-session writes", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", "/repo");
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "claude-code",
      "sess-B",
      2_000,
      "main",
      "/repo",
    );
    expect(matches).toEqual([]);
  });

  it("returns a match for cross-agent + same root + same branch within window", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", "/repo");
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "openclaw",
      "sess-B",
      1_000 + 5 * 60_000,
      "main",
      "/repo",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      agent: "claude-code",
      sessionId: "sess-A",
      branch: "main",
      root: "/repo",
    });
  });

  it("filters out cross-agent matches on a different workspace root", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", "/repo-1");
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "openclaw",
      "sess-B",
      2_000,
      "main",
      "/repo-2",
    );
    expect(matches).toEqual([]);
  });

  it("filters out cross-agent matches on a different branch", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", "/repo");
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "openclaw",
      "sess-B",
      2_000,
      "feature",
      "/repo",
    );
    expect(matches).toEqual([]);
  });

  it("never matches when either side has a null branch", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, null, "/repo");
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "openclaw",
      "sess-B",
      2_000,
      "main",
      "/repo",
    );
    expect(matches).toEqual([]);
  });

  it("never matches when either side has a null workspace root", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", null);
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "openclaw",
      "sess-B",
      2_000,
      "main",
      "/repo",
    );
    expect(matches).toEqual([]);
  });

  it("drops aged-out entries past the 30-min window", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", "/repo");
    expect(idx.entryCount()).toBe(1);
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "openclaw",
      "sess-B",
      1_000 + WINDOW_MS + 1,
      "main",
      "/repo",
    );
    expect(matches).toEqual([]);
    // The aged peer was swept on the second call; only the new entry remains.
    expect(idx.entryCount()).toBe(1);
  });

  it("returns multiple peers when several candidates are in-window", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", "/repo");
    idx.recordAndQuery("/repo/foo.ts", "openclaw", "sess-B", 2_000, "main", "/repo");
    const matches = idx.recordAndQuery(
      "/repo/foo.ts",
      "gemini",
      "sess-C",
      3_000,
      "main",
      "/repo",
    );
    // Both A (claude-code) and B (openclaw) are different agents + different
    // sessions from C — both should match.
    expect(matches).toHaveLength(2);
    const sessions = matches.map((m) => m.sessionId).sort();
    expect(sessions).toEqual(["sess-A", "sess-B"]);
  });

  it("reset() clears all entries", () => {
    const idx = new RecentWritesIndex();
    idx.recordAndQuery("/repo/foo.ts", "claude-code", "sess-A", 1_000, "main", "/repo");
    idx.recordAndQuery("/repo/bar.ts", "openclaw", "sess-B", 1_000, "main", "/repo");
    expect(idx.entryCount()).toBe(2);
    idx.reset();
    expect(idx.entryCount()).toBe(0);
  });
});
