import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Read package.json once at module load. Two candidate paths cover both
// dev (src/util/version.ts → ../../package.json) and the tsup bundle
// (dist/index.js → ../package.json).
function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [
    join(here, "..", "..", "package.json"),
    join(here, "..", "package.json"),
  ]) {
    try {
      return (JSON.parse(readFileSync(p, "utf8")) as { version: string }).version;
    } catch {
      // try next candidate
    }
  }
  return "unknown";
}

export const VERSION: string = readVersion();
