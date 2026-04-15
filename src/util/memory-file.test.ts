import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { memoryFilesFor } from "./memory-file.js";

function withFakeHome(fn: (home: string, cwd: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mf-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mf-cwd-"));
  try {
    fn(home, cwd);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe("memoryFilesFor", () => {
  it("reads CLAUDE.md for claude-code", () => {
    withFakeHome((home, cwd) => {
      fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# project claude");
      const info = memoryFilesFor("claude-code", cwd, home);
      expect(info.paths).toHaveLength(1);
      expect(info.text).toContain("project claude");
    });
  });

  it("concatenates workspace + home Claude memory", () => {
    withFakeHome((home, cwd) => {
      fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "A");
      fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "B");
      const info = memoryFilesFor("claude-code", cwd, home);
      expect(info.paths).toHaveLength(2);
      expect(info.text).toContain("A");
      expect(info.text).toContain("B");
    });
  });

  it("reads AGENTS.md for codex", () => {
    withFakeHome((home, cwd) => {
      fs.writeFileSync(path.join(cwd, "AGENTS.md"), "codex memory");
      expect(memoryFilesFor("codex", cwd, home).text).toContain("codex memory");
    });
  });

  it("reads .cursorrules + .cursor/rules/*.mdc for cursor", () => {
    withFakeHome((home, cwd) => {
      fs.writeFileSync(path.join(cwd, ".cursorrules"), "ROOT RULES");
      fs.mkdirSync(path.join(cwd, ".cursor", "rules"), { recursive: true });
      fs.writeFileSync(path.join(cwd, ".cursor", "rules", "a.mdc"), "RULE A");
      const info = memoryFilesFor("cursor", cwd, home);
      expect(info.paths.length).toBeGreaterThanOrEqual(2);
      expect(info.text).toContain("ROOT RULES");
      expect(info.text).toContain("RULE A");
    });
  });

  it("returns empty info when no memory file exists", () => {
    withFakeHome((home, cwd) => {
      expect(memoryFilesFor("claude-code", cwd, home)).toEqual({
        paths: [],
        text: "",
      });
    });
  });

  it("returns empty info for agents without a memory-file convention", () => {
    withFakeHome((home, cwd) => {
      expect(memoryFilesFor("cline", cwd, home).text).toBe("");
    });
  });
});
