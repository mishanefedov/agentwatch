import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  shims: false,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
  outDir: "dist",
});
