// Two projects, both offline and deterministic (docs/agent/verification.md):
//   unit:    plain Node. Engine, contracts, UI helpers and the eval harness in replay mode.
//   workers: inside workerd via @cloudflare/vitest-pool-workers. Agent, Ledger, Quota, Workflow.
// remoteBindings is false, so no test can reach Workers AI or any remote resource.
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import agents from "agents/vite";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "tests/contracts/**/*.test.ts",
            "tests/engine/**/*.test.ts",
            "tests/ui/**/*.test.ts",
            "evals/**/*.test.ts"
          ]
        }
      },
      {
        plugins: [
          agents(),
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            remoteBindings: false
          })
        ],
        test: {
          name: "workers",
          include: ["tests/agent/**/*.test.ts"]
        }
      }
    ]
  }
});
