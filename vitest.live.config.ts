import { defineConfig } from "vitest/config";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
process.env.SIFT_LIVE_RUN_ID ??= runId;

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/all-live.spec.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 90000,
    hookTimeout: 30000,
    expect: { poll: { timeout: 10000, interval: 100 } },
    update: "none",
    reporters: [
      "default",
      ["json", { outputFile: "test-results/compatibility-report.json" }],
      [
        "json",
        {
          outputFile: `test-results/compatibility-history/${runId}/report.json`,
        },
      ],
    ],
  },
});
