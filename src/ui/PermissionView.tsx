import { Box, Text } from "ink";
import type { ClaudePermissions } from "../util/claude-permissions.js";
import type { CursorStatus } from "../adapters/cursor.js";
import type { OpenClawConfig } from "../util/openclaw-config.js";

interface Props {
  claude: ClaudePermissions[];
  cursor?: CursorStatus;
  openclaw: OpenClawConfig | null;
}

export function PermissionView({ claude, cursor, openclaw }: Props) {
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color="cyan">Permissions / Configuration across installed agents</Text>

      <ClaudeSection permissions={claude} />
      <CursorSection cursor={cursor} />
      <OpenClawSection config={openclaw} />

      <Box marginTop={1}>
        <Text dimColor>
          Press p to close. Gemini CLI exposes no permission model beyond auth, so it is omitted.
        </Text>
      </Box>
    </Box>
  );
}

// ─── Claude ─────────────────────────────────────────────────────────────────

function ClaudeSection({ permissions }: { permissions: ClaudePermissions[] }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">━ Claude Code ━</Text>
      {permissions.length === 0 ? (
        <Text dimColor>  No settings.json found.</Text>
      ) : (
        permissions.map((p) => <ClaudeBlock key={p.source} perms={p} />)
      )}
    </Box>
  );
}

function ClaudeBlock({ perms }: { perms: ClaudePermissions }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text dimColor>source: </Text>
        <Text>{perms.source}</Text>
      </Text>
      <Text>
        <Text dimColor>defaultMode: </Text>
        <Text color={modeColor(perms.defaultMode)}>{perms.defaultMode}</Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="green">CAN ({perms.allow.length})</Text>
        {perms.allow.length === 0 ? (
          <Text dimColor>  (none — defaultMode applies)</Text>
        ) : (
          perms.allow.map((a, i) => (
            <Text key={i}>  <Text color="green">✓</Text> {a}</Text>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="red">CANNOT ({perms.deny.length})</Text>
        {perms.deny.length === 0 ? (
          <Text dimColor>  (none — no explicit denies)</Text>
        ) : (
          perms.deny.map((d, i) => (
            <Text key={i}>  <Text color="red">✗</Text> {d}</Text>
          ))
        )}
      </Box>

      {perms.flags.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">⚠ Flags</Text>
          {perms.flags.map((f, i) => (
            <Text key={i} color={f.level === "risk" ? "red" : "yellow"}>
              {"  "}{f.level === "risk" ? "✗" : "!"} {f.message}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ─── Cursor ─────────────────────────────────────────────────────────────────

function CursorSection({ cursor }: { cursor?: CursorStatus }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">━ Cursor ━</Text>
      {!cursor?.installed ? (
        <Text dimColor>  not detected</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {cursor.permissions ? (
            <>
              <Text>
                <Text dimColor>approvalMode: </Text>
                <Text color={modeColor(cursor.permissions.approvalMode)}>
                  {cursor.permissions.approvalMode}
                </Text>
                <Text dimColor>   sandbox: </Text>
                <Text
                  color={
                    cursor.permissions.sandboxMode === "disabled" ? "red" : "green"
                  }
                >
                  {cursor.permissions.sandboxMode}
                </Text>
              </Text>
              <Text>
                <Text color="green">CAN:</Text>{" "}
                <Text>{cursor.permissions.allowCount}</Text>{" "}
                <Text color="red">CANNOT:</Text>{" "}
                <Text>{cursor.permissions.denyCount}</Text>
              </Text>
            </>
          ) : (
            <Text dimColor>  cli-config.json not parseable</Text>
          )}
          <Text>
            <Text dimColor>MCP servers: </Text>
            <Text>
              {cursor.mcpServers.length === 0
                ? "none"
                : `${cursor.mcpServers.length} (${cursor.mcpServers.join(", ")})`}
            </Text>
          </Text>
          <Text>
            <Text dimColor>.cursorrules discovered: </Text>
            <Text>{cursor.cursorRulesFiles.length}</Text>
          </Text>
          {cursor.cursorRulesFiles.slice(0, 5).map((f, i) => (
            <Text key={i} dimColor>  • {f}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ─── OpenClaw ───────────────────────────────────────────────────────────────

function OpenClawSection({ config }: { config: OpenClawConfig | null }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">━ OpenClaw ━</Text>
      {!config ? (
        <Text dimColor>  not detected</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text dimColor>source: </Text>
            <Text>{config.source}</Text>
          </Text>
          {config.defaultWorkspace && (
            <Text>
              <Text dimColor>default workspace: </Text>
              <Text>{config.defaultWorkspace}</Text>
            </Text>
          )}
          <Text dimColor>
            {"  "}OpenClaw runs with broad shell + file access per agent. No
            allow/deny list — scope is controlled by the workspace path.
          </Text>
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Sub-agents ({config.agents.length})</Text>
            {config.agents.length === 0 ? (
              <Text dimColor>  (none configured)</Text>
            ) : (
              config.agents.map((a) => (
                <Box key={a.id} flexDirection="column" marginTop={1}>
                  <Text>
                    {a.emoji ? `${a.emoji} ` : ""}
                    <Text bold>{a.name ?? a.id}</Text>
                    <Text dimColor> (id: {a.id}{a.default ? ", default" : ""})</Text>
                  </Text>
                  {a.model && (
                    <Text dimColor>  model: {a.model}</Text>
                  )}
                  {a.workspace && (
                    <Text dimColor>  workspace: {a.workspace}</Text>
                  )}
                </Box>
              ))
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function modeColor(mode: string): string {
  if (mode === "auto" || mode === "bypassPermissions") return "red";
  if (mode === "ask" || mode === "allowlist") return "green";
  return "yellow";
}
