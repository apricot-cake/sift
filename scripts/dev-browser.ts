// 開発用の Chrome プロファイルを CDP 付きで起動し、配備済みの production
// ビルドを読み込む。日常用プロファイルと開発用プロファイルは、どちらもこの
// 作業ツリーの .output/chrome-mv3 を展開済み拡張機能として読む。
import { spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { findChromePath } from "./chrome-path.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE =
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile");
const OUTPUT = path.join(ROOT, ".output", "chrome-mv3");
const EXTENSION_ID = "bohbpocokkfioejlabmeaimpkpmablkm";
const CDP_HOST = "127.0.0.1";
const CDP_PORT = Number.parseInt(process.env.SIFT_DEV_CDP_PORT || "9222", 10);
const CDP_URL = `http://${CDP_HOST}:${CDP_PORT}`;

if (!Number.isInteger(CDP_PORT) || CDP_PORT < 1024 || CDP_PORT > 65535) {
  throw new Error("SIFT_DEV_CDP_PORT は 1024〜65535 のポート番号にすること。");
}

interface CdpVersion {
  webSocketDebuggerUrl: string;
}

interface ExtensionInfo {
  id: string;
  path: string;
  enabled: boolean;
}

async function readCdpVersion(): Promise<CdpVersion | null> {
  try {
    const response = await fetch(`${CDP_URL}/json/version`, {
      signal: AbortSignal.timeout(500),
    });
    const value: unknown = await response.json();
    if (
      !response.ok ||
      typeof value !== "object" ||
      value === null ||
      !("webSocketDebuggerUrl" in value) ||
      typeof value.webSocketDebuggerUrl !== "string"
    ) {
      return null;
    }
    return { webSocketDebuggerUrl: value.webSocketDebuggerUrl };
  } catch {
    return null;
  }
}

async function waitForCdp(): Promise<CdpVersion | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const version = await readCdpVersion();
    if (version) return version;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
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

async function loadSharedExtension(version: CdpVersion): Promise<void> {
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

const chrome = process.env.SIFT_CHROME || findChromePath();

if (process.argv.includes("--print")) {
  console.log(`chrome:      ${chrome}`);
  console.log(`プロファイル: ${PROFILE}`);
  console.log(`CDP:         ${CDP_URL}`);
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

let version = await readCdpVersion();
if (!version) {
  const child = spawn(
    chrome,
    [
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-address=${CDP_HOST}`,
      `--remote-debugging-port=${CDP_PORT}`,
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
  child.unref();
  version = await waitForCdp();
  if (!version) {
    throw new Error(
      `[sift] ${CDP_URL} へ接続できない。開発用 Chrome が既に開いているなら閉じてから、もう一度 npm run dev:browser を実行すること。`,
    );
  }
  console.log(`[sift] CDP を有効にした開発用プロファイルを開いた: ${PROFILE}`);
}

await loadSharedExtension(version);
console.log(`[sift] 開発用プロファイルで共有ビルドを読み込んだ: ${OUTPUT}`);
console.log(`[sift] CDP 接続先: ${CDP_URL}`);
