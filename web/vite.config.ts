import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the agentwatch web UI. Built output lands in web/dist/
// which Fastify serves at the root. In dev (port 5173) we proxy /api to
// the running agentwatch backend at :3456.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3456", changeOrigin: true, ws: false },
    },
  },
  build: {
    // Land inside dist/web so tsup + vite output coexist and the npm
    // tarball's "files": ["dist"] picks up both the server bundle and
    // the static web assets.
    outDir: "../dist/web",
    target: "es2022",
    emptyOutDir: true,
    assetsInlineLimit: 8192,
  },
});
