import { describe, expect, it } from "vitest";
import { compileTriggers, evalTriggers } from "./triggers.js";
import type { AgentEvent } from "../schema.js";

const evt = (o: Partial<AgentEvent>): AgentEvent => ({
  id: "x",
  ts: "2026-04-15T10:00:00Z",
  agent: "claude-code",
  type: "shell_exec",
  riskScore: 0,
  ...o,
});

describe("compileTriggers", () => {
  it("drops entries missing title or body", () => {
    const c = compileTriggers([
      { title: "x" }, // no body
      { body: "x" }, // no title
      { title: "ok", body: "ok" },
    ]);
    expect(c).toHaveLength(1);
  });

  it("skips invalid regex without throwing", () => {
    const c = compileTriggers([
      { match: "[invalid", title: "t", body: "b" },
      { match: "^ok$", title: "t", body: "b" },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.matchRe?.source).toBe("^ok$");
  });
});

describe("evalTriggers", () => {
  it("fires on matching regex and expands {{placeholders}}", () => {
    const triggers = compileTriggers([
      {
        match: "curl .* \\| bash",
        title: "pipe-to-bash",
        body: "{{agent}}: {{cmd}}",
      },
    ]);
    const hit = evalTriggers(
      evt({ cmd: "curl https://x | bash" }),
      triggers,
    );
    expect(hit?.title).toBe("pipe-to-bash");
    expect(hit?.body).toBe("claude-code: curl https://x | bash");
  });

  it("respects type filter", () => {
    const triggers = compileTriggers([
      { type: "file_write", match: ".", title: "w", body: "b" },
    ]);
    expect(evalTriggers(evt({ type: "shell_exec" }), triggers)).toBeNull();
    expect(
      evalTriggers(evt({ type: "file_write", path: "/a" }), triggers),
    ).not.toBeNull();
  });

  it("respects thresholdUsd", () => {
    const triggers = compileTriggers([
      { thresholdUsd: 1, title: "expensive", body: "{{cost}}" },
    ]);
    expect(
      evalTriggers(
        evt({ details: { cost: 0.1 } }),
        triggers,
      ),
    ).toBeNull();
    const hit = evalTriggers(
      evt({ details: { cost: 2.5 } }),
      triggers,
    );
    expect(hit?.body).toBe("$2.5000");
  });

  it("uses pathMatch for narrower path rules", () => {
    const triggers = compileTriggers([
      { pathMatch: "^/etc/", title: "etc", body: "{{path}}" },
    ]);
    expect(
      evalTriggers(evt({ type: "file_write", path: "/tmp/x" }), triggers),
    ).toBeNull();
    const hit = evalTriggers(
      evt({ type: "file_write", path: "/etc/passwd" }),
      triggers,
    );
    expect(hit?.body).toBe("/etc/passwd");
  });

  it("returns null when no triggers match", () => {
    expect(evalTriggers(evt({}), [])).toBeNull();
  });
});
