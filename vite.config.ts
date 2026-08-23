import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // GitHub Pages hosts this repository below /DigestMe/; local development stays at /.
  base: process.env.GITHUB_ACTIONS === "true" ? "/DigestMe/" : "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: `${projectRoot}/index.html`,
        "pyodide-service-worker": `${projectRoot}/src/pyodide/serviceWorker.ts`,
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "pyodide-service-worker" ? "[name].js" : "assets/[name]-[hash].js",
      },
    },
  },
});
