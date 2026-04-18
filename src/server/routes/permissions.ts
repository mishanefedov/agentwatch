import type { FastifyInstance } from "fastify";
import { readClaudePermissions } from "../../util/claude-permissions.js";
import { readCodexPermissions } from "../../util/codex-permissions.js";
import { readGeminiPermissions } from "../../util/gemini-permissions.js";
import { readOpenClawConfig } from "../../util/openclaw-config.js";
import { detectWorkspaceRoot } from "../../util/workspace.js";

export function registerPermissionRoutes(app: FastifyInstance): void {
  app.get("/api/permissions", async () => {
    const workspace = detectWorkspaceRoot();
    return {
      claude: readClaudePermissions(workspace),
      codex: readCodexPermissions(),
      gemini: readGeminiPermissions(),
      openclaw: readOpenClawConfig(),
    };
  });
}
