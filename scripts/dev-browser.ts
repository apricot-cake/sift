// 手動確認には、自動検証と同じプロファイルを CDP ポートなしで開く。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readDevBrowserEndpoint } from "./dev-browser-endpoint.ts";
import { devBrowserProfile } from "./managed-dev-browser.ts";

const profile = devBrowserProfile();
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && args[0] !== "--print"))
  throw new Error("利用できる引数は --print だけです。");
const endpoint = await readDevBrowserEndpoint(profile);
if (args[0] === "--print") {
  console.log(`プロファイル: ${profile}`);
  console.log(`CDP ポート:  ${endpoint?.url ?? "無効（自動検証中だけ有効）"}`);
} else {
  if (endpoint)
    throw new Error("CDP が有効な開発用 Chrome を先に閉じてください。");
  fs.mkdirSync(profile, { recursive: true });
  const log = fs.openSync(path.join(profile, "chrome-stderr.log"), "a");
  try {
    const child = spawn(
      process.execPath,
      [path.join(import.meta.dirname, "manual-dev-browser.ts")],
      {
        detached: true,
        stdio: ["ignore", log, log, "ipc"],
        windowsHide: true,
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("message", (message) => {
        if (message === "ready") resolve();
        else reject(new Error("手動確認用 Chrome の起動応答が不正です。"));
      });
      child.once("error", reject);
      child.once("exit", () =>
        reject(
          new Error(
            "手動確認用 Chrome を起動できません。開発用 Chrome を閉じ、候補ビルドを準備してから再実行してください。",
          ),
        ),
      );
    });
    child.disconnect();
    child.unref();
  } finally {
    fs.closeSync(log);
  }
  console.log(`[sift] 手動確認用 Chrome を CDP ポートなしで開いた: ${profile}`);
}
