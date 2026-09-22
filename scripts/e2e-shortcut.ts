import { execFileSync } from "node:child_process";

// 製品版には存在しない、CI 専用の action ショートカット。Chrome のウィンドウへ
// キー入力として届けることで、CDP の Extensions.triggerAction だけでは再現できない
// ユーザー操作コンテキストでサイドパネルを開く。
export const E2E_ACTION_SHORTCUT = "ctrl+shift+y";

export function usesE2eActionShortcut(): boolean {
  return process.env.SIFT_E2E_MODE === "ci";
}

export function sendE2eActionShortcut(): void {
  if (!usesE2eActionShortcut()) return;

  const windows = execFileSync(
    "xdotool",
    ["search", "--onlyvisible", "--class", "google-chrome|chrome"],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const windowId = windows.at(-1);
  if (!windowId) {
    throw new Error("E2E 用 Chrome のウィンドウを見つけられなかった。");
  }

  execFileSync("xdotool", ["windowactivate", "--sync", windowId]);
  execFileSync("xdotool", ["key", "--clearmodifiers", E2E_ACTION_SHORTCUT]);
}
