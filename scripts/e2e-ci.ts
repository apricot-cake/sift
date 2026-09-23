// GitHub Actions の仮想ディスプレイ上で、実際の Chrome サイドパネルを撮影する。
// ローカルのプロファイルやデスクトップを対象にしてはならない。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const artifacts = path.resolve(
  process.env.SIFT_E2E_ARTIFACTS ??
    path.join(ROOT, "test-results", "browser-e2e"),
);
const profile = fs.mkdtempSync(path.join(tmpdir(), "sift-browser-e2e-"));

if (process.env.CI !== "true") {
  throw new Error("実画面の撮影は GitHub Actions の CI でだけ実行します。");
}
if (process.platform !== "win32") {
  throw new Error(
    "ブラウザ E2E は GitHub Actions の Windows 仮想デスクトップでだけ実行します。",
  );
}

fs.mkdirSync(artifacts, { recursive: true });
const env = {
  ...process.env,
  SIFT_DEV_PROFILE: profile,
  SIFT_EXTENSION_OUTPUT: path.join(ROOT, ".output", "e2e", "chrome-mv3"),
  SIFT_E2E_MODE: "ci",
};

function run(script: string, ...arguments_: string[]): void {
  execFileSync(
    process.execPath,
    [path.join(ROOT, "scripts", script), ...arguments_],
    {
      cwd: ROOT,
      env,
      stdio: "inherit",
    },
  );
}

run("dev-browser.ts");
run("browser-integration.ts");
// 最後に公開 YouTube ページを選び直して action を実行する。これにより撮影する
// Chrome ウィンドウには、実際に開いた Sift サイドパネルが残る。
run("dev-browser.ts", "--verify");
await new Promise((resolve) => setTimeout(resolve, 1_500));
run("verify-e2e-panel.ts");
run(
  "capture-e2e-screen.ts",
  path.join(artifacts, "chrome-with-sift-panel.png"),
);
