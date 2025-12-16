import { defineConfig } from "vite";

// GitHub Pages serves under /<repo>/ by default.
// The workflow sets BASE_PATH="/<repo>/"
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  server: { port: 5173, strictPort: true },
  // Enable top-level await in dependencies such as mupdf.
  optimizeDeps: { esbuildOptions: { target: "esnext" } },
  build: { target: "esnext" },
  worker: { format: "es" },
});
