// ローカル配備用の production ビルドを共有出力へ直接作る。検査後に自己
// リロード専用Native Hostを登録し、最後に配備スタンプを発行する。開いて
// いるSiftのサイドパネルは直ちに読み直す。閉じている場合は、次に開くページが
// 配備済みのファイルを直接読むので、追加のリロードはしない。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWindowsUserContext,
  installReloadHost,
  publishBuildStamp,
} from "../native-host/install.ts";
import { buildExtension } from "./build-extension.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

export interface DeployDependencies {
  assertContext(): void;
  build(): { buildId: string; output: string };
  installHost(): unknown;
  publish(buildId: string, output: string): string;
}

export function deployLocalExtension({
  assertContext,
  build,
  installHost,
  publish,
}: DeployDependencies): { buildId: string; output: string; stamp: string } {
  assertContext();
  const result = build();
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
    return true;
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
    assertContext: () => assertWindowsUserContext("npm run deploy"),
    build: () => buildExtension("local"),
    installHost: () => installReloadHost(),
    publish: publishBuildStamp,
  });
  console.log(`[sift] production ビルドを作成して検査した: ${deployed.output}`);
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
