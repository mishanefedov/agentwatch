import { describe, expect, it } from "vitest";
import { translateClaudeLine } from "./claude-code.js";

describe("translateClaudeLine — compaction detection", () => {
  it("emits a compaction event when isCompactSummary=true", () => {
    const e = translateClaudeLine(
      {
        type: "user",
        isCompactSummary: true,
        timestamp: "2026-04-15T10:00:00Z",
        message: {
          role: "user",
          content:
            "This session is being continued from a previous conversation that ran out of context. Summary: …",
        },
      },
      "sess-1",
      "myproj",
    );
    expect(e?.type).toBe("compaction");
    expect(e?.summary).toContain("⋈ context compacted");
    expect(e?.summary).toContain("[myproj]");
  });

  it("still emits a normal prompt when isCompactSummary is absent", () => {
    const e = translateClaudeLine(
      {
        type: "user",
        timestamp: "2026-04-15T10:00:00Z",
        message: { role: "user", content: "hi" },
      },
      "sess-1",
      "myproj",
    );
    expect(e?.type).toBe("prompt");
  });
});
