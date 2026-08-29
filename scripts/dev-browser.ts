// `npm run dev:browser`＝開発用の Chrome プロファイルを、CDP で接続できる形で開く。
//
// プロファイルを分けること自体が目的＝日常のブラウザが載せるのはリリース
// ビルドだけで他は載せないので、拡張機能の開発に関わること（開発サーバーの
// バンドル、保存のたびのタブの再読み込み）は全部こちらで起きる。
//
// 自分の `--user-data-dir` を持つので、日常の Chrome と並んで、自分の
// セッションを持つ2つ目のプロセスとして動く。X へのサインインは人が一度だけ
// 行う手順で、そのログインはプロファイルが保つ。
//
// --load-extension は使わない＝Chrome 137 以降はこれを無視するし（Chrome 151 で
// 確認）、必要も無い。chrome://extensions から一度読み込んだ展開済み拡張機能は、
// プロファイルが覚えている。その最初の読み込みだけが、人のやる部分。
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE =
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile");
const OUTPUT =
  process.env.SIFT_DEV_OUTPUT || path.join(ROOT, ".output", "chrome-mv3-dev");
const CDP_HOST = "127.0.0.1";
const CDP_PORT = Number.parseInt(process.env.SIFT_DEV_CDP_PORT || "9222", 10);
const CDP_URL = `http://${CDP_HOST}:${CDP_PORT}`;

if (!Number.isInteger(CDP_PORT) || CDP_PORT < 1024 || CDP_PORT > 65535) {
  throw new Error("SIFT_DEV_CDP_PORT は 1024〜65535 のポート番号にすること。");
}

async function cdpReady(): Promise<boolean> {
  try {
    const response = await fetch(`${CDP_URL}/json/version`, {
      signal: AbortSignal.timeout(500),
    });
    const value: unknown = await response.json();
    return (
      response.ok &&
      typeof value === "object" &&
      value !== null &&
      "webSocketDebuggerUrl" in value &&
      typeof value.webSocketDebuggerUrl === "string"
    );
  } catch {
    return false;
  }
}

async function waitForCdp(): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await cdpReady()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

// Chrome が実際にどこにあるか。当てずっぽうではなく Windows に訊く＝32bit の
// 導入先を持つ機械はいくらでもあり、64bit の経路を埋め込むと、そこでは見当違いの
// 内容を言いながら失敗する。
function chromePath() {
  const candidates = [
    path.join(
      process.env.PROGRAMFILES || "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    path.join(
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    const found = execFileSync("where.exe", ["chrome"], { encoding: "utf8" })
      .split(/\r?\n/)
      .find(Boolean);
    if (found && fs.existsSync(found)) return found;
  } catch {
    /* PATH にも無い */
  }
  throw new Error(
    "Chrome が見つからない。SIFT_CHROME にその完全な経路を設定すること。",
  );
}

const chrome = process.env.SIFT_CHROME || chromePath();

// `--print` は全部を解決して何も開かない。ブラウザの窓を開くことは、その機械を
// 使っている人から画面とキーボードを奪うので、経路が正しいかを確かめるのにそれを
// 払わせてはならない。
if (process.argv.includes("--print")) {
  console.log(`chrome:      ${chrome}`);
  console.log(`プロファイル: ${PROFILE}`);
  console.log(`CDP:         ${CDP_URL}`);
  console.log(
    `ビルド:      ${OUTPUT}${fs.existsSync(path.join(OUTPUT, "manifest.json")) ? "" : "  (まだビルドされていない)"}`,
  );
  process.exit(0);
}

fs.mkdirSync(PROFILE, { recursive: true });

if (await cdpReady()) {
  console.log(`[sift] 開発用プロファイルは CDP で接続済み: ${CDP_URL}`);
  process.exit(0);
}

// 切り離す＝このコマンドはブラウザを開いて戻る。立っている間ずっとそれを抱える
// のではない。端末を閉じたことでブラウザが閉じてはならない。
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
  },
);
child.unref();

if (!(await waitForCdp())) {
  throw new Error(
    `[sift] ${CDP_URL} へ接続できない。開発用 Chrome が既に開いているなら閉じてから、もう一度 npm run dev:browser を実行すること。`,
  );
}

console.log(
  `[sift] CDP を有効にした開発用 Chrome プロファイルを開いた: ${PROFILE}`,
);
console.log(`[sift] CDP 接続先: ${CDP_URL}`);
if (fs.existsSync(path.join(OUTPUT, "manifest.json"))) {
  console.log(`[sift] 読み込む開発ビルド: ${OUTPUT}`);
} else {
  console.log(
    `[sift] 開発ビルドがまだ無い＝先に "npm run dev" を走らせる（${OUTPUT} へ書かれる）`,
  );
}
console.log(
  "[sift] 最初の1回だけ: chrome://extensions → デベロッパーモード → パッケージ化されていない拡張機能を読み込む → 上の置き場。",
);
console.log(
  "[sift] 日常のプロファイルへは読み込まないこと＝どちらのビルドも同じ拡張機能 id を持っている。検証は CDP でこの接続先だけを使う。",
);
