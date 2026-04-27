import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readNewlineTerminatedLines } from "./jsonl-stream.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "jsonl-stream-"));
}

describe("readNewlineTerminatedLines", () => {
  it("returns terminated lines and a newline-aligned consumed count", () => {
    const dir = tmp();
    const file = join(dir, "x.jsonl");
    writeFileSync(file, '{"a":1}\n{"b":2}\n');
    const { lines, consumed } = readNewlineTerminatedLines(file, 0, 15);
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(consumed).toBe(16);
  });

  it("drops the trailing partial line and reports consumed up to last \\n", () => {
    const dir = tmp();
    const file = join(dir, "x.jsonl");
    writeFileSync(file, '{"a":1}\n{"b":2'); // no trailing newline
    const { lines, consumed } = readNewlineTerminatedLines(file, 0, 13);
    expect(lines).toEqual(['{"a":1}']);
    // Consumed only counts up to and including the last \n.
    expect(consumed).toBe(8);
  });

  it("recovers a previously-partial line after the rest is appended (AUR-227)", () => {
    const dir = tmp();
    const file = join(dir, "x.jsonl");
    // Producer flushes a partial line.
    writeFileSync(file, '{"id":"a","value":');
    let stat = statSync(file);
    const first = readNewlineTerminatedLines(file, 0, stat.size - 1);
    // No terminated lines yet; nothing consumed.
    expect(first.lines).toEqual([]);
    expect(first.consumed).toBe(0);

    // Producer flushes the rest of that line plus the next one.
    appendFileSync(file, '1}\n{"id":"b","value":2}\n');
    stat = statSync(file);
    const second = readNewlineTerminatedLines(
      file,
      first.consumed,
      stat.size - 1,
    );
    // The originally-partial line is now recovered intact.
    expect(second.lines).toEqual([
      '{"id":"a","value":1}',
      '{"id":"b","value":2}',
    ]);
    expect(first.consumed + second.consumed).toBe(stat.size);
  });

  it("handles an empty slice", () => {
    const dir = tmp();
    const file = join(dir, "x.jsonl");
    writeFileSync(file, "");
    const { lines, consumed } = readNewlineTerminatedLines(file, 0, -1);
    expect(lines).toEqual([]);
    expect(consumed).toBe(0);
  });

  it("preserves utf-8 multibyte characters across the newline boundary", () => {
    const dir = tmp();
    const file = join(dir, "x.jsonl");
    writeFileSync(file, '{"x":"héllo"}\n{"y":"日本"}\n');
    const stat = statSync(file);
    const { lines, consumed } = readNewlineTerminatedLines(
      file,
      0,
      stat.size - 1,
    );
    expect(lines).toEqual(['{"x":"héllo"}', '{"y":"日本"}']);
    expect(consumed).toBe(stat.size);
  });
});
