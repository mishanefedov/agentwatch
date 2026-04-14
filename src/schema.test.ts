import { describe, expect, it } from "vitest";
import { riskOf } from "./schema.js";

describe("riskOf", () => {
  it("scores shell_exec with destructive commands highest", () => {
    expect(riskOf("shell_exec", undefined, "rm -rf /tmp/x")).toBe(9);
    expect(riskOf("shell_exec", undefined, "sudo apt install")).toBe(9);
  });

  it("scores normal shell_exec at 6", () => {
    expect(riskOf("shell_exec", undefined, "git status")).toBe(6);
  });

  it("scores file writes to .env / credentials as sensitive", () => {
    expect(riskOf("file_write", "/app/.env")).toBe(9);
    expect(riskOf("file_write", "/home/u/.ssh/id_rsa")).toBe(10);
  });

  it("scores normal file writes at 4, reads at 2", () => {
    expect(riskOf("file_write", "/tmp/ok.txt")).toBe(4);
    expect(riskOf("file_read", "/tmp/ok.txt")).toBe(2);
  });

  it("scores tool_call at 3 and unknown types low", () => {
    expect(riskOf("tool_call")).toBe(3);
    expect(riskOf("prompt")).toBe(1);
    expect(riskOf("response")).toBe(1);
  });
});
