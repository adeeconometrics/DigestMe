import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages hosts this repository below /DigestMe/; local development stays at /.
  base: process.env.GITHUB_ACTIONS === "true" ? "/DigestMe/" : "/",
  plugins: [react()],
});
