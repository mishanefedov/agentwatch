# Use case: What are my agents actually allowed to do?

**Scenario.** You're about to give a teammate access to your Claude Max
plan. Or you're onboarding to a new project where the previous
developer set up Cursor + OpenClaw + Claude Code. What's the blast
radius today?

## With agentwatch

1. `agentwatch`
2. `p` → permissions view
3. Scroll. For each installed agent:

   **Claude Code**
   - `defaultMode: auto` (red) — any tool not in allow/deny auto-runs
   - Flags: `⚠ Bash(*) allows arbitrary shell — any command not
     explicitly denied will run`
   - Flags: `! Write/Edit allowed with no deny rule for ~/.ssh,
     ~/.aws, ~/.gnupg`

   **Cursor**
   - `approvalMode: allowlist` (green) — tighter than Claude's auto
   - `sandbox: disabled` (red) — shell still can touch the host FS
   - MCP servers: 1 (context7)
   - `.cursorrules` discovered: 0

   **OpenClaw**
   - Default workspace: `/Users/.../auraqu/_content_agent_`
   - 3 sub-agents: Quill (content, gemini-3.1-pro), Scout (outreach),
     Yena (research)
   - Note: OpenClaw runs with broad shell + file access per agent

4. Screenshot for your notes
5. Decide which denies to add; edit `~/.claude/settings.json` manually
   (agentwatch is read-only)
6. `p` again — confirm the flagged risks disappeared

## What agentwatch is doing

- Parsing three different permission models into one view.
- Flagging patterns without opinion: doesn't prevent you from
  running `Bash(*)`, just surfaces that you are.
- Gemini CLI section omitted — genuinely exposes no permission model
  beyond auth, so we document that instead of faking a section.

## Without agentwatch

Open three config files. Read each one with different syntax (JSON for
Claude, TOML for Cursor's config, JSON for OpenClaw). Hope you
remember what each field means.
