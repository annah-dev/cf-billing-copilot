import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["evals/**/*.live.ts"],
    fileParallelism: false,
    retry: 0,
    testTimeout: 3_600_000
  }
});
