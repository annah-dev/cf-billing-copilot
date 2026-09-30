import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/no-network.ts"],
    include: ["evals/**/*.fixture.ts"]
  }
});
