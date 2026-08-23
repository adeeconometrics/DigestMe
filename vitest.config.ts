import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**/*.ts",
        "src/parser/contextTree.ts",
        "src/parser/pdfParser.ts",
        "src/chat/agentChat.ts",
        "src/chat/retrieval.ts",
        "src/graph/treeGraph.ts",
        "src/pdf/reference.ts",
        "src/pyodide/artifactCache.ts",
      ],
      exclude: ["tests/**", "src/parser/types.ts"],
    },
  },
});
