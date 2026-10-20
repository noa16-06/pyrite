import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari15",
    outDir: "dist",
    chunkSizeWarningLimit: 2000, // desktop app, loaded from disk
  },
});
