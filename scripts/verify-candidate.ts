import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  cases,
  emptyCases,
  lifecycleCases,
  unsupportedCases,
} from "../e2e/cases.ts";
import { artifactHash } from "./compatibility/artifact.ts";
import { assertLiveCoverage } from "./compatibility/live-coverage.ts";
import {
  sourceHash,
  type VerifiedCandidate,
} from "./compatibility/verification.ts";
import {
  recordVerification,
  runVerificationTasks,
} from "./compatibility/verification-run.ts";

const root = path.resolve(import.meta.dirname, "..");
const receiptFile = path.join(root, ".output", "verified-candidate.json");
let candidate: VerifiedCandidate | undefined;
recordVerification(
  () => {
    candidate = JSON.parse(
      fs.readFileSync(path.join(root, ".output", "candidate.json"), "utf8"),
    );
    if (!candidate) throw new Error("候補ビルドの記録がありません。");
    if (
      candidate.sourceHash !== sourceHash(root) ||
      candidate.sha256 !== artifactHash(candidate.output)
    )
      throw new Error("現在のソースで候補をビルドし直してください。");
    if (process.argv.length > 2)
      throw new Error("全検証では絞り込みや基準更新の引数を指定できません。");
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error("npm run verify:candidate で実行してください。");
    runVerificationTasks((task) => {
      execFileSync(process.execPath, [npm, "run", task], {
        cwd: root,
        stdio: "inherit",
      });
    });
    const report = JSON.parse(
      fs.readFileSync(
        path.join(root, "test-results", "compatibility-report.json"),
        "utf8",
      ),
    );
    const connection = JSON.parse(
      fs.readFileSync(
        path.join(root, "test-results", "connection-smoke.json"),
        "utf8",
      ),
    );
    assertLiveCoverage(
      report,
      cases,
      lifecycleCases,
      emptyCases,
      unsupportedCases,
    );
    if (
      report.stats.expected !==
        cases.length +
          lifecycleCases.length +
          emptyCases.length +
          unsupportedCases.length ||
      report.stats.unexpected ||
      report.stats.skipped ||
      report.stats.flaky ||
      report.errors.length ||
      !connection.pass ||
      connection.cleanupErrors.length
    )
      throw new Error("完全な実機検証結果ではありません。");
    if (
      sourceHash(root) !== candidate.sourceHash ||
      artifactHash(candidate.output) !== candidate.sha256
    )
      throw new Error("検証中にソースまたは成果物が変更されました。");
  },
  (status, error) => {
    fs.writeFileSync(
      receiptFile,
      JSON.stringify(
        {
          ...candidate,
          status,
          recordedAt: new Date().toISOString(),
          ...(status === "passed"
            ? { verifiedAt: new Date().toISOString() }
            : {}),
          ...(error ? { error } : {}),
          cases: [
            ...cases,
            ...lifecycleCases,
            ...emptyCases,
            ...unsupportedCases,
          ].map((c) => c.id),
        },
        null,
        2,
      ),
    );
  },
);
console.log(
  "検証済み候補を記録しました。npm run deploy:local で同じ成果物を配備できます。",
);
