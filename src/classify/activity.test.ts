import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../schema.js";
import {
  ACTIVITY_CATEGORIES,
  classifyEvent,
  type ActivityCategory,
} from "./activity.js";
import { withClassifier } from "./sink.js";

let id = 0;

function evt(over: Partial<AgentEvent>): AgentEvent {
  return {
    id: `e-${++id}`,
    ts: new Date().toISOString(),
    agent: over.agent ?? "claude-code",
    type: over.type ?? "tool_call",
    riskScore: over.riskScore ?? 1,
    path: over.path,
    cmd: over.cmd,
    tool: over.tool,
    summary: over.summary,
    sessionId: over.sessionId,
    promptId: over.promptId,
    details: over.details,
  };
}

interface Case {
  name: string;
  expect: ActivityCategory;
  event: AgentEvent;
}

const CASES: Case[] = [
  // ---- coding ----
  {
    name: "writing a TypeScript source file",
    expect: "coding",
    event: evt({ type: "file_write", path: "src/api/auth.ts", tool: "Write" }),
  },
  {
    name: "editing a Python source file",
    expect: "coding",
    event: evt({ type: "file_change", path: "app/handlers/login.py" }),
  },
  {
    name: "MultiEdit on a Go file",
    expect: "coding",
    event: evt({ type: "file_write", path: "internal/server/routes.go", tool: "MultiEdit" }),
  },
  {
    name: "git commit shell exec",
    expect: "coding",
    event: evt({ type: "shell_exec", tool: "Bash", cmd: "git commit -m feat: add login" }),
  },

  // ---- testing ----
  {
    name: "writing a vitest test file",
    expect: "testing",
    event: evt({ type: "file_write", path: "src/api/auth.test.ts", tool: "Write" }),
  },
  {
    name: "writing a pytest test under tests/",
    expect: "testing",
    event: evt({ type: "file_write", path: "tests/test_login.py" }),
  },
  {
    name: "running npm test",
    expect: "testing",
    event: evt({ type: "shell_exec", tool: "Bash", cmd: "npm test" }),
  },
  {
    name: "running pytest",
    expect: "testing",
    event: evt({ type: "shell_exec", tool: "Bash", cmd: "pytest -k login" }),
  },

  // ---- docs ----
  {
    name: "editing a markdown doc",
    expect: "docs",
    event: evt({ type: "file_write", path: "docs/features/api.md" }),
  },
  {
    name: "editing the README",
    expect: "docs",
    event: evt({ type: "file_write", path: "README.md" }),
  },
  {
    name: "editing CHANGELOG",
    expect: "docs",
    event: evt({ type: "file_write", path: "CHANGELOG.md" }),
  },

  // ---- config ----
  {
    name: "editing tsconfig.json",
    expect: "config",
    event: evt({ type: "file_write", path: "tsconfig.json" }),
  },
  {
    name: "editing a yaml config",
    expect: "config",
    event: evt({ type: "file_write", path: "k8s/deployment.yaml" }),
  },
  {
    name: "editing package.json",
    expect: "config",
    event: evt({ type: "file_write", path: "package.json" }),
  },

  // ---- debugging ----
  {
    name: "prompt mentioning a stack trace",
    expect: "debugging",
    event: evt({
      type: "prompt",
      details: { fullText: "I'm getting a stack trace when I call /login — can you fix this bug?" },
    }),
  },
  {
    name: "shell exec with tool error",
    expect: "debugging",
    event: evt({
      type: "shell_exec",
      tool: "Bash",
      cmd: "npm run build",
      details: { toolError: true },
    }),
  },

  // ---- refactor ----
  {
    name: "prompt asking to refactor",
    expect: "refactor",
    event: evt({
      type: "prompt",
      details: { fullText: "please refactor this file to extract the validation logic into its own module" },
    }),
  },
  {
    name: "prompt asking to rename",
    expect: "refactor",
    event: evt({
      type: "prompt",
      details: { fullText: "rename getUser to fetchUserById and move it to api/user.ts" },
    }),
  },

  // ---- exploration ----
  {
    name: "Grep tool call",
    expect: "exploration",
    event: evt({ type: "tool_call", tool: "Grep" }),
  },
  {
    name: "reading a non-config source file",
    expect: "exploration",
    event: evt({ type: "file_read", path: "src/util/cost.ts" }),
  },

  // ---- research ----
  {
    name: "WebFetch tool call",
    expect: "research",
    event: evt({ type: "tool_call", tool: "WebFetch" }),
  },
  {
    name: "WebSearch tool call",
    expect: "research",
    event: evt({ type: "tool_call", tool: "WebSearch" }),
  },

  // ---- review ----
  {
    name: "git diff shell exec",
    expect: "review",
    event: evt({ type: "shell_exec", tool: "Bash", cmd: "git diff main" }),
  },
  {
    name: "prompt asking to audit",
    expect: "review",
    event: evt({
      type: "prompt",
      details: { fullText: "please audit this file for SQL injection vulnerabilities" },
    }),
  },

  // ---- devops ----
  {
    name: "kubectl shell exec",
    expect: "devops",
    event: evt({ type: "shell_exec", tool: "Bash", cmd: "kubectl get pods -n prod" }),
  },
  {
    name: "docker shell exec",
    expect: "devops",
    event: evt({ type: "shell_exec", tool: "Bash", cmd: "docker compose up -d" }),
  },
  {
    name: "terraform shell exec",
    expect: "devops",
    event: evt({ type: "shell_exec", tool: "Bash", cmd: "terraform apply" }),
  },

  // ---- planning ----
  {
    name: "long thinking block",
    expect: "planning",
    event: evt({
      type: "response",
      details: {
        thinking: "Let me think through this carefully. ".repeat(80),
      },
    }),
  },
  {
    name: "compaction event",
    expect: "planning",
    event: evt({ type: "compaction" }),
  },

  // ---- chat ----
  {
    name: "session_start",
    expect: "chat",
    event: evt({ type: "session_start" }),
  },
  {
    name: "empty assistant turn",
    expect: "chat",
    event: evt({
      type: "response",
      details: { fullText: "Sure, here you go." },
    }),
  },
];

describe("classifier — synthetic case dataset", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(classifyEvent(c.event)).toBe(c.expect);
    });
  }

  it("hits at least 75% top-1 agreement on the synthetic dataset", () => {
    let matches = 0;
    for (const c of CASES) {
      if (classifyEvent(c.event) === c.expect) matches += 1;
    }
    const ratio = matches / CASES.length;
    expect(ratio).toBeGreaterThanOrEqual(0.75);
  });

  it("returns one of the declared categories for any non-empty input", () => {
    const valid = new Set<string>(ACTIVITY_CATEGORIES);
    for (const c of CASES) {
      expect(valid.has(classifyEvent(c.event))).toBe(true);
    }
  });
});

describe("classifier — withClassifier sink wrapper", () => {
  it("attaches details.category to events that don't already have one", () => {
    const captured: AgentEvent[] = [];
    const inner = {
      emit: (e: AgentEvent) => captured.push(e),
      enrich: () => undefined,
    };
    const wrapped = withClassifier(inner);
    wrapped.emit(
      evt({ type: "file_write", path: "src/api.ts", tool: "Write" }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.details?.category).toBe("coding");
  });

  it("doesn't overwrite a category an upstream sink already set", () => {
    const captured: AgentEvent[] = [];
    const inner = {
      emit: (e: AgentEvent) => captured.push(e),
      enrich: () => undefined,
    };
    const wrapped = withClassifier(inner);
    wrapped.emit(
      evt({
        type: "file_write",
        path: "src/api.ts",
        details: { category: "review" },
      }),
    );
    expect(captured[0]?.details?.category).toBe("review");
  });

  it("forwards enrich unchanged", () => {
    const enriches: Array<{ id: string; patch: object }> = [];
    const inner = {
      emit: () => undefined,
      enrich: (id: string, patch: object) => enriches.push({ id, patch }),
    };
    const wrapped = withClassifier(inner);
    wrapped.enrich("e-1", { toolResult: "ok" });
    expect(enriches).toEqual([{ id: "e-1", patch: { toolResult: "ok" } }]);
  });
});
