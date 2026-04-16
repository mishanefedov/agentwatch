import { describe, expect, it } from "vitest";
import { detectAgentCall, tokenize } from "./agent-call.js";

describe("tokenize", () => {
  it("handles plain whitespace splits", () => {
    expect(tokenize("codex exec hello")).toEqual(["codex", "exec", "hello"]);
  });

  it("preserves quoted strings", () => {
    expect(tokenize(`codex exec "hello world"`)).toEqual([
      "codex",
      "exec",
      "hello world",
    ]);
    expect(tokenize(`gemini -p 'short prompt'`)).toEqual([
      "gemini",
      "-p",
      "short prompt",
    ]);
  });

  it("respects backslash escapes inside quotes", () => {
    expect(tokenize(`x "a\\"b"`)).toEqual(["x", `a"b`]);
  });
});

describe("detectAgentCall — codex", () => {
  it("matches `codex exec` with quoted prompt", () => {
    expect(detectAgentCall(`codex exec "review my plan"`)).toEqual({
      callee: "codex",
      kind: "exec",
      prompt: "review my plan",
      model: undefined,
    });
  });

  it("matches `codex chat` as kind=chat", () => {
    expect(detectAgentCall("codex chat")).toMatchObject({
      callee: "codex",
      kind: "chat",
    });
  });

  it("falls back to kind=unknown for unrecognised codex subcommands", () => {
    expect(detectAgentCall("codex --help")).toMatchObject({
      callee: "codex",
      kind: "unknown",
    });
  });

  it("strips an absolute path on the binary", () => {
    expect(
      detectAgentCall(`/opt/homebrew/bin/codex exec "what's wrong with my plan?"`),
    ).toMatchObject({
      callee: "codex",
      kind: "exec",
      prompt: "what's wrong with my plan?",
    });
  });
});

describe("detectAgentCall — gemini", () => {
  it("matches `gemini -p` and extracts the prompt flag", () => {
    expect(detectAgentCall(`gemini -p "review my plan"`)).toEqual({
      callee: "gemini",
      kind: "exec",
      prompt: "review my plan",
      model: undefined,
    });
  });

  it("matches `gemini --prompt=value` long form", () => {
    expect(detectAgentCall(`gemini --prompt="hello"`)).toMatchObject({
      callee: "gemini",
      prompt: "hello",
    });
  });

  it("matches `gemini` with a positional prompt fallback", () => {
    expect(detectAgentCall(`gemini hi`)).toMatchObject({
      callee: "gemini",
      prompt: "hi",
    });
  });
});

describe("detectAgentCall — claude", () => {
  it("matches `claude exec`", () => {
    expect(detectAgentCall(`claude exec "do the thing"`)).toMatchObject({
      callee: "claude-code",
      kind: "exec",
      prompt: "do the thing",
    });
  });
});

describe("detectAgentCall — ollama", () => {
  it("captures the model and prompt for `ollama run`", () => {
    expect(detectAgentCall(`ollama run llama3 "say hi"`)).toMatchObject({
      callee: "unknown",
      kind: "exec",
      model: "llama3",
      prompt: "say hi",
    });
  });
});

describe("detectAgentCall — wrappers", () => {
  it("strips `npx -y` wrapper", () => {
    expect(detectAgentCall(`npx -y codex exec "foo"`)).toMatchObject({
      callee: "codex",
      kind: "exec",
      prompt: "foo",
    });
  });

  it("strips `pnpm dlx` wrapper", () => {
    expect(detectAgentCall(`pnpm dlx gemini -p "bar"`)).toMatchObject({
      callee: "gemini",
      prompt: "bar",
    });
  });

  it("strips `env FOO=bar` prefix and `nice`/`time`", () => {
    expect(detectAgentCall(`time env FOO=1 codex exec "baz"`)).toMatchObject({
      callee: "codex",
      prompt: "baz",
    });
  });

  it("strips nvm exec <version> wrapper", () => {
    expect(
      detectAgentCall(`nvm exec 22 codex exec "via nvm"`),
    ).toMatchObject({ callee: "codex", prompt: "via nvm" });
  });
});

describe("detectAgentCall — false positives", () => {
  it("returns null for ordinary shell commands", () => {
    expect(detectAgentCall("ls -la")).toBeNull();
    expect(detectAgentCall("git log --oneline")).toBeNull();
    expect(detectAgentCall("npm publish")).toBeNull();
  });

  it("does not match commands that merely contain an agent name", () => {
    // a script called codex-rs/build.sh is not codex itself
    expect(detectAgentCall("./codex-rs/build.sh release")).toBeNull();
    // a grep for the word "codex" is not invoking codex
    expect(detectAgentCall(`grep -r "codex" src/`)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(detectAgentCall("")).toBeNull();
    expect(detectAgentCall("   ")).toBeNull();
  });
});
