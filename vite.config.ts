import { defineConfig } from "vite";

// GitHub Pages serves under /<repo>/ by default.
// The workflow sets BASE_PATH="/<repo>/"
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  server: { port: 5173, strictPort: true },
  build: { target: "esnext" },
  worker: { format: "es" },
});
