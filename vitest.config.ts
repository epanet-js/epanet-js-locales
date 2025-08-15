import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["translate/__tests__/**/*.test.ts"],
    globals: true,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html"],
      exclude: [
        "**/__tests__/**",
        "node_modules/**",
        "main.ts", // integration covered by orchestration test
      ],
    },
  },
});
