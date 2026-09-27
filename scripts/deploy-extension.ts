// 検証済みの候補を共有出力へ昇格し、最後に再読み込み通知を発行する。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWindowsUserContext,
  installReloadHost,
  publishBuildStamp,
} from "../native-host/install.ts";
import {
  assertVerified,
  promoteCandidate,
  sourceHash,
  type VerifiedCandidate,
} from "./compatibility/verification.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

export interface DeployDependencies {
  assertContext(): void;
  promote(): { buildId: string; output: string };
  installHost(): unknown;
  publish(buildId: string, output: string): string;
}

export function deployLocalExtension({
  assertContext,
  promote,
  installHost,
  publish,
}: DeployDependencies): { buildId: string; output: string; stamp: string } {
  assertContext();
  const result = promote();
  installHost();
  const stamp = publish(result.buildId, result.output);
  return { ...result, stamp };
}

function isDeployableMainWorkingTree(): boolean {
  try {
    return (
      fs.statSync(path.join(ROOT, ".git")).isDirectory() &&
      execSync("git branch --show-current", {
        cwd: ROOT,
        encoding: "utf8",
      }).trim() === "main"
    );
  } catch {
    return false;
  }
}

function main(): void {
  if (!isDeployableMainWorkingTree()) {
    console.log(
      "[sift] main の主作業ツリーではない＝配備を飛ばす（この出力先を読むブラウザは無い）",
    );
    return;
  }

  const deployed = deployLocalExtension({
    assertContext: () => assertWindowsUserContext("npm run deploy:local"),
    promote: () => {
      const candidate: VerifiedCandidate = JSON.parse(
        fs.readFileSync(path.join(ROOT, ".output", "candidate.json"), "utf8"),
      );
      const receipt = JSON.parse(
        fs.readFileSync(
          path.join(ROOT, ".output", "verified-candidate.json"),
          "utf8",
        ),
      );
      assertVerified(candidate, receipt, sourceHash(ROOT));
      return {
        buildId: candidate.buildId,
        output: promoteCandidate(ROOT, candidate),
      };
    },
    installHost: () => installReloadHost(),
    publish: publishBuildStamp,
  });
  console.log(`[sift] 検証済みの同一成果物を配備した: ${deployed.output}`);
  console.log(
    `[sift] 自己リロード用の配備IDを発行した: ${deployed.buildId} (${deployed.stamp})`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
