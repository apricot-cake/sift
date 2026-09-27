// 開発用 Chrome プロファイルを固定の CDP ポートで起動する。Sift はこの
// プロファイルであらかじめ展開済み拡張機能として登録する。
import { spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { findChromePath } from "./chrome-path.ts";
import {
  type DevBrowserEndpoint,
  readDevBrowserEndpoint,
} from "./dev-browser-endpoint.ts";

const PROFILE =
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile");
const PROFILE_DIRECTORY = "Default";
const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9224;
const cliArguments = process.argv.slice(2);

if (
  cliArguments.length > 1 ||
  (cliArguments[0] && cliArguments[0] !== "--print")
) {
  throw new Error("利用できる引数は --print だけです。");
}

async function waitForCdp(): Promise<DevBrowserEndpoint | null> {
  // 起動済みかどうかは固定時間ではなく、実際の CDP endpoint で判定する。
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const version = await readDevBrowserEndpoint(PROFILE, CDP_PORT);
    if (version) return version;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

const chrome = process.env.SIFT_CHROME || findChromePath();
const chromeLogPath = path.join(PROFILE, "chrome-stderr.log");

if (cliArguments.includes("--print")) {
  console.log(`chrome:      ${chrome}`);
  console.log(`プロファイル: ${PROFILE}`);
  const endpoint = await readDevBrowserEndpoint(PROFILE, CDP_PORT);
  console.log(
    `CDP:         ${endpoint?.url ?? `未起動（起動時は ${CDP_HOST}:${CDP_PORT}）`}`,
  );
  process.exit(0);
}

fs.mkdirSync(PROFILE, { recursive: true });

let version = await readDevBrowserEndpoint(PROFILE, CDP_PORT);
if (!version) {
  const chromeLog = fs.openSync(chromeLogPath, "w");
  const child = spawn(
    chrome,
    [
      `--user-data-dir=${PROFILE}`,
      `--profile-directory=${PROFILE_DIRECTORY}`,
      `--remote-debugging-address=${CDP_HOST}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
    {
      detached: true,
      stdio: ["ignore", chromeLog, chromeLog],
      windowsHide: true,
    },
  );
  fs.closeSync(chromeLog);
  const launchFailed = new Promise<never>((_, reject) => {
    child.once("error", reject);
  });
  child.unref();
  version = await Promise.race([waitForCdp(), launchFailed]);
  if (!version) {
    const chromeLogOutput = fs.existsSync(chromeLogPath)
      ? fs.readFileSync(chromeLogPath, "utf8").trim().slice(-4_000)
      : "";
    throw new Error(
      `[sift] 専用プロファイルの CDP 接続先を確認できない: ${PROFILE}。` +
        (chromeLogOutput
          ? ` Chrome の出力: ${chromeLogOutput}`
          : " Chrome が起動中か、起動直後に終了した。"),
    );
  }
  console.log(`[sift] CDP を有効にした開発用プロファイルを開いた: ${PROFILE}`);
}

console.log(`[sift] CDP 接続先: ${version.url}`);
