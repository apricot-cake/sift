// `npm run dev:browser` / `npm run dev:marker`＝開発用の Chrome プロファイルを開く。
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

const PROFILE =
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile");
const OUTPUT =
  process.env.SIFT_DEV_OUTPUT ||
  path.join(homedir(), ".sift-dev", "chrome-mv3-dev");
const marker = process.argv.includes("--marker")
  ? `data:text/html;charset=utf-8,${encodeURIComponent(
      "<title>Sift 開発プロファイル</title><main>Sift 開発プロファイル</main>",
    )}`
  : null;

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
  console.log(
    `ビルド:      ${OUTPUT}${fs.existsSync(path.join(OUTPUT, "manifest.json")) ? "" : "  (まだビルドされていない)"}`,
  );
  process.exit(0);
}

fs.mkdirSync(PROFILE, { recursive: true });

// 切り離す＝このコマンドはブラウザを開いて戻る。立っている間ずっとそれを抱える
// のではない。端末を閉じたことでブラウザが閉じてはならない。
const child = spawn(
  chrome,
  [`--user-data-dir=${PROFILE}`, ...(marker ? [marker] : [])],
  {
    detached: true,
    stdio: "ignore",
  },
);
child.unref();

console.log(
  marker
    ? `[sift] 開発用プロファイルに識別ページを開いた: ${PROFILE}`
    : `[sift] 開発用の Chrome プロファイルを開いた: ${PROFILE}`,
);
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
  "[sift] 日常のプロファイルへは読み込まないこと＝どちらのビルドも同じ拡張機能 id を持っている。",
);
