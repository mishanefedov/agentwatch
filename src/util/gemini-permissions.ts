import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Gemini CLI permission surface from ~/.gemini/settings.json and
 * ~/.gemini/trustedFolders.json.
 */

export interface GeminiPermissions {
  settingsPath: string;
  trustedFoldersPath: string;
  authType?: string;
  selectedModel?: string;
  trustedFolders: string[];
  toolsAllow?: string[];
  toolsBlock?: string[];
  present: boolean;
}

export function readGeminiPermissions(
  home: string = os.homedir(),
): GeminiPermissions {
  const settingsPath = path.join(home, ".gemini", "settings.json");
  const trustedFoldersPath = path.join(home, ".gemini", "trustedFolders.json");
  const out: GeminiPermissions = {
    settingsPath,
    trustedFoldersPath,
    trustedFolders: [],
    present: false,
  };
  if (!fs.existsSync(settingsPath)) return out;
  out.present = true;
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const sec = (raw?.security ?? {}) as Record<string, unknown>;
    const auth = (sec.auth ?? {}) as Record<string, unknown>;
    out.authType =
      typeof auth.selectedType === "string"
        ? auth.selectedType
        : typeof auth.method === "string"
          ? auth.method
          : undefined;
    out.selectedModel =
      typeof raw.selectedModel === "string"
        ? raw.selectedModel
        : typeof raw.model === "string"
          ? raw.model
          : undefined;
    const tools = (raw.tools ?? {}) as Record<string, unknown>;
    if (Array.isArray(tools.allow)) {
      out.toolsAllow = tools.allow as string[];
    }
    if (Array.isArray(tools.block)) {
      out.toolsBlock = tools.block as string[];
    }
  } catch {
    /* unreadable settings */
  }
  try {
    const raw = JSON.parse(fs.readFileSync(trustedFoldersPath, "utf8"));
    if (Array.isArray(raw)) {
      out.trustedFolders = raw.filter((x): x is string => typeof x === "string");
    } else if (raw && typeof raw === "object") {
      out.trustedFolders = Object.keys(raw);
    }
  } catch {
    /* no trusted folders file */
  }
  return out;
}
