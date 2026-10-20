/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // contracts.ts has no imports, so web can share it with the server.
      "@contracts": path.resolve(import.meta.dirname, "../server/src/contracts.ts"),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: { "/api": "http://localhost:3000" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    env: { VITE_MOCK: "1" },
  },
});
