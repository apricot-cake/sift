// 開発用の Chrome プロファイルを CDP 付きで起動し、配備済みの production
// ビルドを読み込む。日常用プロファイルと開発用プロファイルは、どちらもこの
// 作業ツリーの .output/chrome-mv3 を展開済み拡張機能として読む。
import { spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { selectAdapter } from "../utils/adapters/index.ts";
import { findChromePath } from "./chrome-path.ts";
import {
  type DevBrowserEndpoint,
  readDevBrowserEndpoint,
} from "./dev-browser-endpoint.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE =
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile");
const OUTPUT = process.env.SIFT_EXTENSION_OUTPUT
  ? path.resolve(process.env.SIFT_EXTENSION_OUTPUT)
  : path.join(ROOT, ".output", "chrome-mv3");
const EXTENSION_ID = "bohbpocokkfioejlabmeaimpkpmablkm";
const CDP_HOST = "127.0.0.1";

interface ExtensionInfo {
  id: string;
  path: string;
  enabled: boolean;
}

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface CdpTargetInfo {
  targetId: string;
  type: string;
  url: string;
}

async function waitForCdp(): Promise<DevBrowserEndpoint | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const version = await readDevBrowserEndpoint(PROFILE);
    if (version) return version;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function readCdpTargets(
  version: DevBrowserEndpoint,
): Promise<CdpTarget[]> {
  const response = await fetch(`${version.url}/json/list`);
  if (!response.ok) {
    throw new Error("[sift] CDP からタブ一覧を読めなかった。");
  }
  return (await response.json()) as CdpTarget[];
}

async function cdpCall<T>(
  webSocketDebuggerUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP ${method} が時間内に応答しなかった。`));
    }, 5000);

    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      socket.close();
      callback();
    };

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      if (message.error) {
        finish(() => reject(new Error(message.error.message ?? method)));
      } else {
        finish(() => resolve(message.result as T));
      }
    });
    socket.addEventListener("error", () => {
      finish(() => reject(new Error(`CDP ${method} の接続に失敗した。`)));
    });
  });
}

async function loadSharedExtension(version: DevBrowserEndpoint): Promise<void> {
  const loaded = await cdpCall<{ id: string }>(
    version.webSocketDebuggerUrl,
    "Extensions.loadUnpacked",
    { path: OUTPUT },
  );
  const listed = await cdpCall<{ extensions: ExtensionInfo[] }>(
    version.webSocketDebuggerUrl,
    "Extensions.getExtensions",
  );
  const extension = listed.extensions.find((item) => item.id === loaded.id);
  if (
    loaded.id !== EXTENSION_ID ||
    !extension?.enabled ||
    path.resolve(extension.path) !== path.resolve(OUTPUT)
  ) {
    throw new Error(
      `CDP が共有ビルドを有効にできなかった: ${loaded.id} ${extension?.path ?? "(pathなし)"}`,
    );
  }
}

async function verifySupportedPage(version: DevBrowserEndpoint): Promise<void> {
  const target = (await readCdpTargets(version)).find((candidate) => {
    if (candidate.type !== "page") return false;
    try {
      return selectAdapter(new URL(candidate.url).hostname) !== null;
    } catch {
      return false;
    }
  });
  if (!target) {
    throw new Error(
      "[sift] 開発用 Chrome に対応サイトのタブが無い。確認対象を開いてから再実行すること。",
    );
  }

  await cdpCall(target.webSocketDebuggerUrl, "Page.reload", {
    ignoreCache: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const targetInfos = await cdpCall<{ targetInfos: CdpTargetInfo[] }>(
    version.webSocketDebuggerUrl,
    "Target.getTargets",
    { filter: [{ type: "tab", exclude: false }, { exclude: true }] },
  );
  const tabTarget = targetInfos.targetInfos.find(
    (candidate) => candidate.type === "tab" && candidate.url === target.url,
  );
  if (!tabTarget) {
    throw new Error(
      "[sift] 再読み込みしたページのタブを CDP で特定できなかった。",
    );
  }
  await cdpCall(version.webSocketDebuggerUrl, "Extensions.triggerAction", {
    id: EXTENSION_ID,
    targetId: tabTarget.targetId,
  });
  console.log(
    `[sift] 対応サイトを再読み込み、サイドパネル操作を実行した: ${target.url}`,
  );
}

const chrome = process.env.SIFT_CHROME || findChromePath();

if (process.argv.includes("--print")) {
  console.log(`chrome:      ${chrome}`);
  console.log(`プロファイル: ${PROFILE}`);
  const endpoint = await readDevBrowserEndpoint(PROFILE);
  console.log(
    `CDP:         ${endpoint?.url ?? "未起動（起動時に空きポートを自動取得）"}`,
  );
  console.log(
    `ビルド:      ${OUTPUT}${fs.existsSync(path.join(OUTPUT, "manifest.json")) ? "" : "  (まだ配備されていない)"}`,
  );
  process.exit(0);
}

if (!fs.existsSync(path.join(OUTPUT, "manifest.json"))) {
  throw new Error(
    `[sift] 共有ビルドが無い。先に "npm run deploy" を実行すること: ${OUTPUT}`,
  );
}

fs.mkdirSync(PROFILE, { recursive: true });

let version = await readDevBrowserEndpoint(PROFILE);
if (!version) {
  const child = spawn(
    chrome,
    [
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-address=${CDP_HOST}`,
      "--remote-debugging-port=0",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const launchFailed = new Promise<never>((_, reject) => {
    child.once("error", reject);
  });
  child.unref();
  version = await Promise.race([waitForCdp(), launchFailed]);
  if (!version) {
    throw new Error(
      `[sift] 専用プロファイルの CDP 接続先を確認できない: ${PROFILE}。旧方式で起動した開発用 Chrome が残っている場合は、その開発用 Chrome を閉じて npm run dev:browser を再実行すること。`,
    );
  }
  console.log(`[sift] CDP を有効にした開発用プロファイルを開いた: ${PROFILE}`);
}

await loadSharedExtension(version);
console.log(`[sift] 開発用プロファイルで共有ビルドを読み込んだ: ${OUTPUT}`);
console.log(`[sift] CDP 接続先: ${version.url}`);

if (process.argv.includes("--verify")) {
  await verifySupportedPage(version);
}
