import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// VITE_API_URL must be set in the EdgeOne (or any static host) build environment.
// It must be the full origin of the Replit API server, e.g.:
//   https://2ebfeb9d-4c8c-433b-958d-b0b29cd8ab22-00-t72zn54iuweo.worf.replit.dev
// Without this, all /api/* calls will hit the CDN (which returns empty/HTML).
const apiUrl = process.env.VITE_API_URL ?? "";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(apiUrl),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "../../dist"),
    emptyOutDir: true,
  },
});
