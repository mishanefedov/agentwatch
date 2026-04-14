import { Box, Text } from "ink";
import type { ClaudePermissions } from "../util/claude-permissions.js";

interface Props {
  permissions: ClaudePermissions[];
}

export function PermissionView({ permissions }: Props) {
  if (permissions.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="double" paddingX={1}>
        <Text bold color="cyan">Permissions — Claude Code</Text>
        <Text dimColor>No settings.json found at ~/.claude/ or project .claude/</Text>
        <Text dimColor>Press p to close.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color="cyan">Permissions — Claude Code</Text>
      {permissions.map((p) => (
        <Block key={p.source} perms={p} />
      ))}
      <Box marginTop={1}>
        <Text dimColor>Press p to close. These are the permissions Claude Code uses on your machine.</Text>
      </Box>
    </Box>
  );
}

function Block({ perms }: { perms: ClaudePermissions }) {
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

      <Box marginTop={1} flexDirection="column">
        <Text bold color="green">CAN ({perms.allow.length})</Text>
        {perms.allow.length === 0 ? (
          <Text dimColor>  (none — defaultMode applies)</Text>
        ) : (
          perms.allow.map((a, i) => (
            <Text key={i}>  <Text color="green">✓</Text> {a}</Text>
          ))
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="red">CANNOT ({perms.deny.length})</Text>
        {perms.deny.length === 0 ? (
          <Text dimColor>  (none — no explicit denies)</Text>
        ) : (
          perms.deny.map((d, i) => (
            <Text key={i}>  <Text color="red">✗</Text> {d}</Text>
          ))
        )}
      </Box>

      {perms.additionalDirectories.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Additional writable directories</Text>
          {perms.additionalDirectories.map((d, i) => (
            <Text key={i}>  • {d}</Text>
          ))}
        </Box>
      )}

      {perms.flags.length > 0 && (
        <Box marginTop={1} flexDirection="column">
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

function modeColor(mode: string): string {
  if (mode === "auto" || mode === "bypassPermissions") return "red";
  if (mode === "ask") return "green";
  return "yellow";
}
