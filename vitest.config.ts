import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**/*.ts",
        "src/parser/contextTree.ts",
        "src/parser/pdfParser.ts",
        "src/chat/retrieval.ts",
        "src/graph/treeGraph.ts",
        "src/pdf/reference.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "src/test/**",
        "src/parser/types.ts",
      ],
    },
  },
});
