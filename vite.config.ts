import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@server": resolve(__dirname, "server"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "index.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
