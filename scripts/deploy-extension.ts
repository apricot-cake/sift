// 現在のソースをビルドして共有出力へ配備し、再読み込み通知を発行する。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWindowsUserContext,
  installReloadHost,
  publishBuildStamp,
} from "../native-host/install.ts";
import { promoteCandidate } from "./compatibility/verification.ts";
import { prepareCandidate } from "./prepare-candidate.ts";

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
    assertContext: () => assertWindowsUserContext("pnpm run deploy:local"),
    promote: () => {
      const candidate = prepareCandidate();
      return {
        buildId: candidate.buildId,
        output: promoteCandidate(ROOT, candidate),
      };
    },
    installHost: () => installReloadHost(),
    publish: publishBuildStamp,
  });
  console.log(`[sift] 現在のソースをビルドして配備した: ${deployed.output}`);
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
