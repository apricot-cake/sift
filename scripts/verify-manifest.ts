// リリースビルドが、ソースの宣言どおりのものを持っているかを確かめる。そして
// これ自身は何も宣言しない。以下の期待値はどれも、それを持っている唯一の場所から
// 読んでいる＝WXT に渡す manifest は wxt.config.ts、サイトは
// utils/site-matches.ts、バージョンは package.json。手で揃え続けるものはここに
// 1つも無い。
//
// これは manifest.legacy.json との比較を置き換えたもの。あれは、WXT が manifest
// を生成するようになる前（CRXJS を経て WXT へ戻るまで）に拡張機能が持っていた
// 手書きの manifest だった。あのファイルは同じ決定の2つ目の写しで、wxt.config.ts
// を変えるたびに、検査が通るようにそこへも同じ変更を書き写す必要があった＝
// だから変更を捕まえたことは一度も無い。変更を二重に記録し、バージョン番号を
// 2箇所に置いていただけ。
//
// 確かめる価値があるのは、ソースからは見えない工程の方＝`wxt build` は content
// script が manifest へ届いたかどうかに関わらず 0 で終了するし、content script を
// 欠いた拡張機能は、読み込まれ、worker を動かし、目に見えることを何もしない。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SITE_MATCHES } from "../utils/site-matches.ts";
import config from "../wxt.config.ts";

// どのビルドを読むか。`wxt build -b <対象>` は .output/<対象>-mv3-release へ書き、
// 以下はどちらの対象でも成り立つ＝manifest は wxt.config.ts の中の1つの宣言で
// あり、2つ目の対象を確かめる意味は、それがそのままであり続けることにある。
const TARGETS = new Set(["chrome", "firefox"]);
const target = process.argv[2] ?? "chrome";
if (!TARGETS.has(target)) {
  throw new Error(
    `知らないビルド対象: ${target}（${[...TARGETS].join(" / ")} のどれかのはず）`,
  );
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const generatedManifest = JSON.parse(
  await readFile(`.output/${target}-mv3-release/manifest.json`, "utf8"),
);

// WXT はここにオブジェクトのほか関数や promise も受け取る。このプロジェクトが
// 宣言しているのは素のオブジェクトで、他の2つをオブジェクトのつもりで読むと
// `undefined` と比べることになり、以下の主張が全部通ってしまう。
const declaredManifest = config.manifest;
if (
  typeof declaredManifest !== "object" ||
  declaredManifest === null ||
  declaredManifest instanceof Promise
) {
  throw new Error(
    "wxt.config.ts が manifest を素のオブジェクトとして宣言しなくなっている＝この検査はそれとして読んでいる",
  );
}

assert.equal(generatedManifest.manifest_version, config.manifestVersion);
assert.equal(generatedManifest.name, declaredManifest.name);
assert.equal(generatedManifest.description, declaredManifest.description);
// 固定の署名鍵＝それに伴い、どのプロファイルも既に入れてある拡張機能の id。
// これを失ったビルドは、別の拡張機能として入ることになる。
assert.equal(generatedManifest.key, declaredManifest.key);
const declaredPermissions = declaredManifest.permissions ?? [];
const expectedPermissions =
  target === "chrome"
    ? [...declaredPermissions, "sidePanel"]
    : declaredPermissions;
assert.deepEqual(generatedManifest.permissions, expectedPermissions);
// misskey.io はビルド時に確定した既定ホスト（#41）＝ここが静的な
// host_permissions と一致しなければ、インストール直後から追加操作なしに動く
// という受け入れ条件を検査するものが無い。
assert.deepEqual(
  generatedManifest.host_permissions,
  declaredManifest.host_permissions,
);
assert.equal(generatedManifest.optional_host_permissions, undefined);

// バージョンがあるのは package.json だけ。ここへは WXT が写す。
assert.equal(generatedManifest.version, packageJson.version);

// 説明文は文ではなくメッセージ名で、それを解決するのはブラウザの manifest の
// 読み手＝しかも黙って解決するので、名前が違っていたりファイルがビルドへ入って
// いなかったりすると、拡張機能は説明文を1つも持たないまま残る。それを言うものは
// 他に無い＝`wxt build` は名前を読まないし、locales/*.yml から生成された
// _locales が届いたかも確かめない。
assert.equal(generatedManifest.default_locale, declaredManifest.default_locale);
const defaultMessages = JSON.parse(
  await readFile(
    `.output/${target}-mv3-release/_locales/${generatedManifest.default_locale}/messages.json`,
    "utf8",
  ),
);
const descriptionKey = generatedManifest.description.replace(
  /^__MSG_(.+)__$/,
  "$1",
);
assert.notEqual(
  descriptionKey,
  generatedManifest.description,
  "manifest の説明文がリテラルになっている＝メッセージを名指ししているべき",
);
assert.ok(
  descriptionKey in defaultMessages,
  `manifest の説明文が ${descriptionKey} を名指ししているが、${generatedManifest.default_locale} のメッセージファイルはそれを持っていない`,
);

// `action` の題は wxt.config.ts から来る。サイドパネルだけを入口にするので、
// 生成物に popup は含めない。
assert.equal(
  generatedManifest.action.default_title,
  declaredManifest.action?.default_title,
);
assert.equal(generatedManifest.action.default_popup, undefined);

// WXT の sidepanel エントリポイントは対象ブラウザごとに API の異なる manifest
// 項目へ変換する。Chrome は side_panel と sidePanel 権限、Firefox は
// sidebar_action を持つ。entrypoint がページを出力しただけでは、ブラウザの
// サイドバーから開けることは保証されないため、生成物で両方を確かめる。
if (target === "firefox") {
  assert.equal(
    generatedManifest.sidebar_action.default_panel,
    "sidepanel.html",
  );
  assert.equal(generatedManifest.sidebar_action.open_at_install, false);
} else {
  assert.equal(generatedManifest.side_panel.default_path, "sidepanel.html");
  assert.ok(generatedManifest.permissions.includes("sidePanel"));
}

// サイドパネルは現在のページだけを調整する。他のサイトや保存済みページの設定は
// ブラウザの拡張機能設定からも開ける専用ページに分ける。
assert.equal(generatedManifest.options_ui.page, "options.html");
assert.equal(generatedManifest.options_ui.open_in_tab, true);

// 2つの対象が本当に違う唯一の項目＝Chrome MV3 は service worker を取り、
// Firefox MV3 はスクリプトの一覧を取る。どちらも同じ entrypoints/background.ts
// から作られるので、これは「WXT が頼まれた対象に合わせて出力を形作った」ことを
// 言っている＝Chrome 用のものを二度出したのではなく。
if (target === "firefox") {
  assert.deepEqual(generatedManifest.background.scripts, ["background.js"]);
} else {
  assert.equal(generatedManifest.background.service_worker, "background.js");
}

// content script。wxt.config.ts のどの宣言もこれを生まない＝ここにあるのは
// entrypoints/content/index.ts がそこへビルドされたからでしかない。
assert.equal(generatedManifest.content_scripts.length, 1);
const [generatedContentScript] = generatedManifest.content_scripts;
assert.deepEqual(
  [...generatedContentScript.matches].sort(),
  [...SITE_MATCHES].sort(),
);
// バンドル1つとスタイルシート1つ＝スクリプトの import も、その
// `import "./style.css"` も、どちらも通ってきている。
assert.equal(generatedContentScript.js.length, 1);
assert.equal(generatedContentScript.css.length, 1);

console.log(
  `生成された ${target} の manifest は、ソースの宣言どおりのものを持っている`,
);
