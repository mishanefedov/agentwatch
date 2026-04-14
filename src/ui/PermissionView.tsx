import { Box, Text } from "ink";
import type { ClaudePermissions } from "../util/claude-permissions.js";
import type { CursorStatus } from "../adapters/cursor.js";
import type { OpenClawConfig } from "../util/openclaw-config.js";

interface Props {
  claude: ClaudePermissions[];
  cursor?: CursorStatus;
  openclaw: OpenClawConfig | null;
  /** How many rows (beyond header + footer) can fit in the visible box. */
  viewportRows: number;
  /** Scroll offset in rows, 0 = top. */
  scrollOffset: number;
}

type Row =
  | { kind: "h1"; text: string; color?: string }
  | { kind: "h2"; text: string; color?: string }
  | { kind: "kv"; label: string; value: string; valueColor?: string }
  | { kind: "item"; mark: string; markColor?: string; text: string }
  | { kind: "text"; text: string; dim?: boolean; color?: string }
  | { kind: "blank" };

export function PermissionView({
  claude,
  cursor,
  openclaw,
  viewportRows,
  scrollOffset,
}: Props) {
  const rows = buildRows(claude, cursor, openclaw);
  const height = Math.max(3, viewportRows);
  const maxScroll = Math.max(0, rows.length - height);
  const offset = Math.min(scrollOffset, maxScroll);
  const visible = rows.slice(offset, offset + height);

  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1}>
      <Text bold color="cyan">Permissions / Configuration across installed agents</Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((row, i) => (
          <RowView key={i} row={row} />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {rows.length > height
            ? `${offset + 1}–${offset + visible.length} of ${rows.length}  [↑↓] scroll  `
            : ""}
          [p] close  [q] quit
        </Text>
      </Box>
    </Box>
  );
}

function RowView({ row }: { row: Row }) {
  switch (row.kind) {
    case "h1":
      return (
        <Text bold color={row.color ?? "cyan"}>
          ━ {row.text} ━
        </Text>
      );
    case "h2":
      return (
        <Text bold color={row.color ?? "white"}>
          {row.text}
        </Text>
      );
    case "kv":
      return (
        <Text>
          <Text dimColor>{row.label}: </Text>
          <Text color={row.valueColor}>{row.value}</Text>
        </Text>
      );
    case "item":
      return (
        <Text>
          {"  "}
          <Text color={row.markColor}>{row.mark}</Text>
          <Text> {row.text}</Text>
        </Text>
      );
    case "text":
      return (
        <Text color={row.color} dimColor={row.dim}>
          {row.text || " "}
        </Text>
      );
    case "blank":
      return <Text> </Text>;
  }
}

function buildRows(
  claude: ClaudePermissions[],
  cursor: CursorStatus | undefined,
  openclaw: OpenClawConfig | null,
): Row[] {
  const rows: Row[] = [];

  // ─── Claude ───────────────────────────────────────────────────────────
  rows.push({ kind: "h1", text: "Claude Code", color: "cyan" });
  if (claude.length === 0) {
    rows.push({ kind: "text", text: "  No settings.json found.", dim: true });
  } else {
    for (const perms of claude) {
      rows.push({ kind: "blank" });
      rows.push({ kind: "kv", label: "source", value: perms.source });
      rows.push({
        kind: "kv",
        label: "defaultMode",
        value: perms.defaultMode,
        valueColor: modeColor(perms.defaultMode),
      });
      rows.push({ kind: "blank" });
      rows.push({
        kind: "h2",
        text: `CAN (${perms.allow.length})`,
        color: "green",
      });
      if (perms.allow.length === 0) {
        rows.push({
          kind: "text",
          text: "  (none — defaultMode applies)",
          dim: true,
        });
      } else {
        for (const a of perms.allow)
          rows.push({ kind: "item", mark: "✓", markColor: "green", text: a });
      }
      rows.push({ kind: "blank" });
      rows.push({
        kind: "h2",
        text: `CANNOT (${perms.deny.length})`,
        color: "red",
      });
      if (perms.deny.length === 0) {
        rows.push({
          kind: "text",
          text: "  (none — no explicit denies)",
          dim: true,
        });
      } else {
        for (const d of perms.deny)
          rows.push({ kind: "item", mark: "✗", markColor: "red", text: d });
      }
      if (perms.flags.length > 0) {
        rows.push({ kind: "blank" });
        rows.push({ kind: "h2", text: "⚠ Flags", color: "yellow" });
        for (const f of perms.flags) {
          rows.push({
            kind: "item",
            mark: f.level === "risk" ? "✗" : "!",
            markColor: f.level === "risk" ? "red" : "yellow",
            text: f.message,
          });
        }
      }
    }
  }

  // ─── Cursor ───────────────────────────────────────────────────────────
  rows.push({ kind: "blank" });
  rows.push({ kind: "h1", text: "Cursor", color: "magenta" });
  if (!cursor?.installed) {
    rows.push({ kind: "text", text: "  not detected", dim: true });
  } else {
    rows.push({ kind: "blank" });
    if (cursor.permissions) {
      rows.push({
        kind: "kv",
        label: "approvalMode",
        value: cursor.permissions.approvalMode,
        valueColor: modeColor(cursor.permissions.approvalMode),
      });
      rows.push({
        kind: "kv",
        label: "sandbox",
        value: cursor.permissions.sandboxMode,
        valueColor:
          cursor.permissions.sandboxMode === "disabled" ? "red" : "green",
      });
      rows.push({
        kind: "text",
        text: `  allow: ${cursor.permissions.allowCount}   deny: ${cursor.permissions.denyCount}`,
      });
    }
    rows.push({
      kind: "kv",
      label: "MCP servers",
      value:
        cursor.mcpServers.length === 0
          ? "none"
          : `${cursor.mcpServers.length} (${cursor.mcpServers.join(", ")})`,
    });
    rows.push({
      kind: "kv",
      label: ".cursorrules discovered",
      value: String(cursor.cursorRulesFiles.length),
    });
    for (const f of cursor.cursorRulesFiles.slice(0, 10))
      rows.push({ kind: "text", text: `  • ${f}`, dim: true });
  }

  // ─── OpenClaw ─────────────────────────────────────────────────────────
  rows.push({ kind: "blank" });
  rows.push({ kind: "h1", text: "OpenClaw", color: "yellow" });
  if (!openclaw) {
    rows.push({ kind: "text", text: "  not detected", dim: true });
  } else {
    rows.push({ kind: "blank" });
    rows.push({ kind: "kv", label: "source", value: openclaw.source });
    if (openclaw.defaultWorkspace) {
      rows.push({
        kind: "kv",
        label: "default workspace",
        value: openclaw.defaultWorkspace,
      });
    }
    rows.push({
      kind: "text",
      text: "  OpenClaw runs with broad shell + file access per agent. No allow/deny list — scope is the workspace path.",
      dim: true,
    });
    rows.push({ kind: "blank" });
    rows.push({
      kind: "h2",
      text: `Sub-agents (${openclaw.agents.length})`,
    });
    if (openclaw.agents.length === 0) {
      rows.push({ kind: "text", text: "  (none configured)", dim: true });
    } else {
      for (const a of openclaw.agents) {
        rows.push({ kind: "blank" });
        rows.push({
          kind: "text",
          text: `${a.emoji ?? "•"} ${a.name ?? a.id} (id: ${a.id}${a.default ? ", default" : ""})`,
        });
        if (a.model) rows.push({ kind: "text", text: `  model: ${a.model}`, dim: true });
        if (a.workspace)
          rows.push({ kind: "text", text: `  workspace: ${a.workspace}`, dim: true });
      }
    }
  }

  rows.push({ kind: "blank" });
  rows.push({
    kind: "text",
    text: "Gemini CLI exposes no permission model beyond auth, so it is omitted.",
    dim: true,
  });

  return rows;
}

function modeColor(mode: string): string {
  if (mode === "auto" || mode === "bypassPermissions") return "red";
  if (mode === "ask" || mode === "allowlist") return "green";
  return "yellow";
}

/** Row count so callers can compute scroll bounds. */
export function permissionRowCount(
  claude: ClaudePermissions[],
  cursor: CursorStatus | undefined,
  openclaw: OpenClawConfig | null,
): number {
  return buildRows(claude, cursor, openclaw).length;
}
