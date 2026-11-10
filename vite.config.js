import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    rollupOptions: { input: { main: resolve("index.html"), privacy: resolve("privacy.html") } },
  },
});
