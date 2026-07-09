import { describe, expect, it } from "vitest";
import {
  parseCursorComposerEntries,
  parseCursorPromptEntries,
  translateCursorComposer,
  translateCursorPrompt,
  type CursorComposerEntry,
} from "./cursor.js";

describe("parseCursorComposerEntries", () => {
  it("reads entries from the { allComposers: [...] } wrapper shape", () => {
    const entries = parseCursorComposerEntries(
      JSON.stringify({
        allComposers: [
          {
            composerId: "c-1",
            createdAt: 1_700_000_000_000,
            totalLinesAdded: 12,
            totalLinesRemoved: 3,
            isArchived: false,
          },
        ],
      }),
    );
    expect(entries).toEqual([
      {
        composerId: "c-1",
        createdAt: 1_700_000_000_000,
        totalLinesAdded: 12,
        totalLinesRemoved: 3,
        isArchived: false,
      },
    ]);
  });

  it("also accepts a bare array shape", () => {
    const entries = parseCursorComposerEntries(
      JSON.stringify([{ composerId: "c-2", createdAt: 1_700_000_001_000 }]),
    );
    expect(entries).toEqual([
      {
        composerId: "c-2",
        createdAt: 1_700_000_001_000,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        isArchived: false,
      },
    ]);
  });

  it("drops entries missing composerId or createdAt", () => {
    const entries = parseCursorComposerEntries(
      JSON.stringify({
        allComposers: [
          { composerId: "no-created-at" },
          { createdAt: 1 },
          { composerId: "ok", createdAt: 1 },
        ],
      }),
    );
    expect(entries.map((e) => e.composerId)).toEqual(["ok"]);
  });

  it("returns [] for malformed JSON instead of throwing", () => {
    expect(parseCursorComposerEntries("not json")).toEqual([]);
    expect(parseCursorComposerEntries("")).toEqual([]);
  });
});

describe("parseCursorPromptEntries", () => {
  it("reads {text, commandType} entries", () => {
    const prompts = parseCursorPromptEntries(
      JSON.stringify([
        { text: "fix the bug", commandType: 4 },
        { text: "add a test" },
      ]),
    );
    expect(prompts).toEqual([
      { text: "fix the bug", commandType: 4 },
      { text: "add a test", commandType: undefined },
    ]);
  });

  it("drops entries with no usable text", () => {
    const prompts = parseCursorPromptEntries(
      JSON.stringify([{ text: "" }, { commandType: 1 }, { text: "keep me" }]),
    );
    expect(prompts).toEqual([{ text: "keep me", commandType: undefined }]);
  });

  it("returns [] for a non-array or malformed value", () => {
    expect(parseCursorPromptEntries(JSON.stringify({ not: "an array" }))).toEqual([]);
    expect(parseCursorPromptEntries("{broken")).toEqual([]);
  });
});

const BASE_COMPOSER: CursorComposerEntry = {
  composerId: "composer-abcdef12",
  createdAt: 1_700_000_000_000,
  totalLinesAdded: 40,
  totalLinesRemoved: 10,
  isArchived: false,
};

describe("translateCursorComposer", () => {
  it("emits a session_start tagged agent=cursor with linesChanged + timestamp", () => {
    const e = translateCursorComposer(BASE_COMPOSER, "/db/state.vscdb");
    expect(e.agent).toBe("cursor");
    expect(e.type).toBe("session_start");
    expect(e.sessionId).toBe("composer-abcdef12");
    expect(e.ts).toBe(new Date(BASE_COMPOSER.createdAt).toISOString());
    expect(e.details?.linesChanged).toEqual({ added: 40, removed: 10 });
    expect(e.summary).toContain("+40/-10");
    expect(e.summary).not.toContain("archived");
  });

  it("tags archived composers in the summary", () => {
    const e = translateCursorComposer({ ...BASE_COMPOSER, isArchived: true }, "/db");
    expect(e.summary).toContain("[archived]");
  });

  it("derives a deterministic id from the composerId (stable across repeated backfills)", () => {
    const a = translateCursorComposer(BASE_COMPOSER, "/db/state.vscdb");
    const b = translateCursorComposer(BASE_COMPOSER, "/db/state.vscdb");
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(`cursor-${BASE_COMPOSER.composerId}`);
  });
});

describe("translateCursorPrompt", () => {
  it("anchors the prompt's ts + sessionId to the given composer", () => {
    const e = translateCursorPrompt({ text: "refactor the parser" }, 0, BASE_COMPOSER, "/db");
    expect(e.agent).toBe("cursor");
    expect(e.type).toBe("prompt");
    expect(e.sessionId).toBe(BASE_COMPOSER.composerId);
    expect(e.ts).toBe(new Date(BASE_COMPOSER.createdAt).toISOString());
    expect(e.details?.fullText).toBe("refactor the parser");
    expect(e.summary).toBe("refactor the parser");
  });

  it("truncates long prompt text into a single-line summary under 140 chars", () => {
    const long = "x".repeat(500);
    const e = translateCursorPrompt({ text: long }, 0, BASE_COMPOSER, "/db");
    expect(e.summary?.length).toBeLessThanOrEqual(140);
    expect(e.summary?.endsWith("...")).toBe(true);
    expect(e.details?.fullText).toBe(long);
  });

  it("derives a deterministic id from composerId + array index (stable across repeated backfills)", () => {
    const a = translateCursorPrompt({ text: "fix the bug" }, 3, BASE_COMPOSER, "/db");
    const b = translateCursorPrompt({ text: "fix the bug" }, 3, BASE_COMPOSER, "/db");
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(`cursor-${BASE_COMPOSER.composerId}-p3`);
  });

  it("gives different prompts at different indices different ids", () => {
    const a = translateCursorPrompt({ text: "one" }, 0, BASE_COMPOSER, "/db");
    const b = translateCursorPrompt({ text: "two" }, 1, BASE_COMPOSER, "/db");
    expect(a.id).not.toBe(b.id);
  });
});
