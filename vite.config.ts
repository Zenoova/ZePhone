import path from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  // Vite options tailored for Tauri development.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // The Baresip build tree (sources, vcpkg) is huge and locked while it builds: never watch or scan it.
    watch: { ignored: ["**/src-tauri/**", "**/.baresip-build/**"] },
  },
  optimizeDeps: { entries: ["index.html"] },
  build: {
    target: "safari15",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
