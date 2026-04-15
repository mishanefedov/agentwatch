# agentwatch MCP server

Expose your local agent history to any MCP-compatible client (Claude
Code, Cursor, custom LangChain/CrewAI agents, …) so running agents can
inspect what they — or other agents — did before. All local. No
network. No telemetry.

## Quick start

```bash
# Option A — if agentwatch is on your PATH (npm i -g)
claude mcp add agentwatch -- agentwatch mcp

# Option B — npx on demand
claude mcp add agentwatch -- npx -y @misha_misha/agentwatch mcp
```

Restart Claude Code, then run `/mcp` inside the TUI — `agentwatch`
should appear with 5 tools listed.

## Manual install (edit config by hand)

### Claude Code

Edit `~/.claude.json` (or `~/.claude/config.json` depending on your
version):

```json
{
  "mcpServers": {
    "agentwatch": {
      "command": "npx",
      "args": ["-y", "@misha_misha/agentwatch", "mcp"]
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json` (or use Cursor's "Add MCP Server" UI):

```json
{
  "mcpServers": {
    "agentwatch": {
      "command": "npx",
      "args": ["-y", "@misha_misha/agentwatch", "mcp"]
    }
  }
}
```

### Generic MCP client (stdio)

Any client that speaks MCP over stdio. Example:

```json
{
  "command": "npx",
  "args": ["-y", "@misha_misha/agentwatch", "mcp"]
}
```

## Tools exposed

| Tool | Args | Returns |
|---|---|---|
| `list_recent_sessions` | `limit?: 1-100` | `[{agent, sessionId, project, lastActivity, sizeBytes}]` newest first |
| `get_session_events` | `sessionId: string`, `maxBytes?: 1024-10_000_000` | Raw JSONL lines for that session (tail-capped) |
| `search_sessions` | `query: string`, `limit?: 1-50` | `[{session, agent, line}]` substring hits |
| `get_tool_usage_stats` | `sessionId?: string`, `limit?: 1-500` | `{scannedSessions, turns, tools: [{tool, count, totalDurationMs, errorCount}]}` |
| `get_session_cost` | `sessionId: string` | `{totalCostUsd, turns, tokens:{input,cacheRead,cacheCreate,output}, byModel}` |

## Example agent prompts

After wiring it up, try asking your agent:

- *"Use agentwatch to list my five most recent sessions and summarize what I was working on."*
- *"Use agentwatch get_tool_usage_stats to tell me which tools Claude has been failing on most often this week."*
- *"How much have I spent on session \<id\> today? Use agentwatch."*

## Notes

- **All local.** The server reads `~/.claude/projects/**/*.jsonl` and
  `~/.codex/sessions/**/*.jsonl` directly; no data leaves your machine.
- **Fresh every request.** Unlike the TUI, the MCP server does not
  maintain in-memory state — each call re-reads from disk. That means
  edits to sessions are reflected immediately, but heavy bulk queries
  (`get_tool_usage_stats` without `sessionId`) scan up to `limit`
  session files.
- **No write tools.** The server is read-only by design — an agent can
  look but can't modify session history.
