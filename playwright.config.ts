import { defineConfig } from "@playwright/test";

const runId = new Date().toISOString().replace(/[:.]/g, "-");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  use: { actionTimeout: 10000, navigationTimeout: 30000 },
  expect: { timeout: 10000 },
  outputDir: `test-results/compatibility-history/${runId}/artifacts`,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/compatibility-report.json" }],
    [
      "json",
      { outputFile: `test-results/compatibility-history/${runId}/report.json` },
    ],
  ],
  snapshotPathTemplate: "{testDir}/../test/compatibility-baselines/{arg}{ext}",
  updateSnapshots: "none",
});
