import { execFileSync } from "node:child_process";
import path from "node:path";

// 製品版には存在しない、CI 専用の action ショートカット。Chrome のウィンドウへ
// キー入力として届けることで、CDP の Extensions.triggerAction だけでは再現できない
// ユーザー操作コンテキストでサイドパネルを開く。
export const E2E_ACTION_SHORTCUT = "ctrl+shift+y";
const ROOT = path.resolve(import.meta.dirname, "..");
const WINDOWS_E2E_PROJECT = path.join(
  ROOT,
  "tests",
  "windows-e2e",
  "Sift.WindowsE2E.csproj",
);

export function usesE2eActionShortcut(): boolean {
  return process.env.SIFT_E2E_MODE === "ci";
}

export function sendE2eActionShortcut(): void {
  if (!usesE2eActionShortcut()) return;

  if (process.platform !== "win32") {
    throw new Error(`Windows E2E を実行できない OS: ${process.platform}`);
  }

  // Windows runner の Chrome を UI Automation で前面化してから、実キー入力を
  // 送る。CDP の Extensions.triggerAction では再現できない経路を確認する。
  execFileSync(
    "dotnet",
    [
      "run",
      "--no-build",
      "--configuration",
      "Release",
      "--project",
      WINDOWS_E2E_PROJECT,
      "--",
      "shortcut",
    ],
    { stdio: "inherit" },
  );
}
