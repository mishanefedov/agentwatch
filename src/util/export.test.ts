import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportSession, sessionToMarkdown } from "./export.js";
import type { AgentEvent } from "../schema.js";

const sample: AgentEvent[] = [
  {
    id: "1",
    ts: "2026-04-15T10:00:00Z",
    agent: "claude-code",
    type: "prompt",
    sessionId: "sess-abc12345",
    riskScore: 0,
    summary: "[demo] user prompt",
    details: { fullText: "hello agent" },
  },
  {
    id: "2",
    ts: "2026-04-15T10:00:05Z",
    agent: "claude-code",
    type: "shell_exec",
    sessionId: "sess-abc12345",
    riskScore: 6,
    cmd: "ls -la",
    tool: "Bash",
    details: { toolResult: "total 0" },
  },
];

describe("sessionToMarkdown", () => {
  it("renders events ordered by timestamp with prompt + command blocks", () => {
    const md = sessionToMarkdown(sample, "sess-abc12345", "claude-code");
    expect(md).toContain("agentwatch session export");
    expect(md).toContain("**Agent:** claude-code");
    expect(md).toContain("> hello agent");
    expect(md).toContain("```sh\nls -la\n```");
    expect(md).toContain("```sh\ntotal 0\n```");
  });
});

describe("exportSession", () => {
  it("writes both .md and .json files with session-prefixed names", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentwatch-export-"));
    const result = exportSession(
      sample,
      "sess-abc12345",
      "claude-code",
      dir,
      new Date("2026-04-15T10:05:00Z"),
    );
    expect(fs.existsSync(result.mdPath)).toBe(true);
    expect(fs.existsSync(result.jsonPath)).toBe(true);
    expect(path.basename(result.mdPath)).toMatch(/^claude-code-sess-abc-/);
    const json = JSON.parse(fs.readFileSync(result.jsonPath, "utf8"));
    expect(json).toHaveLength(2);
    expect(json[0].id).toBe("1");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
