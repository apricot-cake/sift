<p align="center"><a href="development.md">English</a> ・ <strong>日本語</strong></p>

# Sift 開発

開発は日常のChromeとは別のプロファイルで行います。日常のChromeには検証済みのreleaseだけを載せます。

## Node

Node 24.12以降。`.node-version` と `package.json` の `engines` の両方に書いてあり、CIは `.node-version` が指すものを入れます。`scripts\` 配下はビルドを挟まずnodeが直接動かすので、node自身の型剥ぎに乗っています——それがexperimentalでなくなったのが24.12です。

## 依存

`package.json` のバージョンはすべて完全固定で、次の `npm install` が範囲指定を書き戻さないように `.npmrc` で `save-exact=true` にしてあります。更新はDependabotのPRで届きます（週次、minorとpatchはまとめて）＝ワークフローの `uses:` をSHAで固定してDependabotに動かさせているのと同じ仕組みです。範囲指定だと、それを言うコミットが無いまま依存が動きます。

## 開発サーバー

```powershell
npm run dev
```

出力先は `~\.sift-dev\chrome-mv3-dev` に固定してあり、どのworktreeから起こしても同じ場所に出ます。待ち受けは `127.0.0.1:51732` だけで、ポートが使用中でも別のポートへは移らず失敗します（拡張がこのアドレス向けにビルドされるため）。同時に起こせる開発サーバーは1つだけです。

## 開発ビルドと開発サーバーのつながり

開発ビルドのcontent scriptはmanifestに載っていません。service workerが開発サーバーへ接続した後に `browser.scripting.registerContentScripts()` で登録するため、つながっていないworkerではcontent scriptが動きません。

WXTがソケットを張るのはworkerの起動時に1回だけです。開発サーバーより先にブラウザが起きていた場合や、サーバーを起こし直した場合は切れたままになりますが、開発ビルドはこれを自分で検出します。workerが5秒ごとにサーバーへ問い合わせ、起動時と違うサーバー（または未登録の状態）を見つけると `browser.runtime.reload()` で復帰します。出力フォルダへビルドが書き終わるまでは待ちます（空のフォルダをリロードすると拡張が読み込み解除されるため）。

状態は `~\.sift\extension-errors.log` の `"kind":"dev-link"` 行で読めます。書く先が開発サーバーなので、サーバーが落ちている間は何も出ません。developmentビルドだけが書きます。

- `development link: linked` — つながっていて登録もある
- `development link: building` — サーバーは居るがビルドがまだ
- `development link: adopt` — 新しいサーバーにつながった
- `development link: reload` — 復帰のため自分を起動し直した
- `content script started on <URL>` — そのページにcontent scriptが入った
- `filter pass: <n> hit, <n> rising, <n> hidden, toolbar mounted` — 最初の判定が通りツールバーが出た

## 開発プロファイル

```powershell
npm run dev:browser
```

専用の `--user-data-dir` でChromeを開きます。日常のChromeとは別プロセスで、並べて使えます。初回だけ `chrome://extensions` から `~\.sift-dev\chrome-mv3-dev` を読み込み、Xへログインします。以後はプロファイルが覚えます。

service workerの中身を差し替えたときだけ、`chrome://extensions` のリロード（または開発プロファイルのウィンドウで `Alt+R`）を1回押します。

developmentとreleaseは同じ拡張IDを持つため、同じプロファイルには同居できません。開発ビルドを日常のプロファイルへ読み込まないでください。

パスの確認だけなら `node scripts/dev-browser.ts --print` がウィンドウを開かずに解決結果を表示します。

## 日常Chromeへの反映

mainへマージすると `post-merge` フックが `npm run deploy` を走らせ、検証済みのreleaseを `.output\chrome-mv3` へ差し替えます（フックは `npm install` 時に `scripts/setup.ts` が設定します）。手で走らせることもできます。

```powershell
npm run deploy
```

検証を通らなかったときは差し替えず、日常のChromeは前の版のまま動き続けます。リンクされたworktreeでは差し替えません。

## 未捕捉例外の記録

コードが受け止めそこねた例外は拡張自身が捕まえ、`browser.storage.local` の環状バッファ（新しい50件）へ書きます。捕まえる側はreleaseにも入っています。developmentビルドでは、service workerがバッファを開発サーバーへ送り、`~\.sift\extension-errors.log` へ1行1件のJSONで追記します。

日常側のバッファを読み出す口はまだありません。content scriptは発生元が拡張と分かる例外だけを、popupとservice workerは全件を記録します。

## 文言

読み手が見る文字列はすべて `public\_locales\<言語>\messages.json` にあり、`utils\i18n.ts` を通して読みます。既定ロケールは `en` なので、Siftが文言を持たない言語のブラウザには英語が出ます。拡張側に言語の切り替えはありません＝`browser.i18n` にそれを提供する手段が無く、WXTのi18nガイド自身も専用ライブラリではなく素のAPIを勧めています。

文言への経路は3つ：

- コード中の `t("name")`。メッセージ名は英語ファイルから型付けしてあります（`i18n.d.ts` がWXT自身の `browser.i18n` の型にマージするので、打ち間違いはコンパイルを通りません）
- `entrypoints\popup\index.html` の `data-i18n` / `data-i18n-placeholder` / `data-i18n-aria-label`。`localizeDocument()` が埋めます＝静的HTMLはmanifestのように `__MSG_name__` を持てません
- `wxt.config.ts` の `__MSG_name__`。これを解釈するのはmanifestの該当フィールドだけです

popupのマークアップには英語の文言そのものも書いてあります（`main.ts` が走る前の一瞬のため）。`utils\i18n.test.ts` がそれをmessagesファイルと同じ言葉に固定し、2つのロケールが同じ名前を持つことと、どちらにも無い名前を使っていないことを確認します。manifestのdescriptionについては `verify-manifest.ts` が同じことをします。

テストは `test\i18n.ts` 経由で `public\_locales\en` を読みます＝これが `browser.i18n.getMessage` の代わりです（WXTのfake browserは未実装のまま）。

## Lint

```powershell
npm run lint
```

Biomeがツリー全体を1度に見ます＝整形・lintルール・importの順序。書き換えはしません。直すのは `npm run lint:fix` で、見るものは同じです。

インデント・改行・末尾改行は `biome.jsonc` で宣言せず `.editorconfig` から読ませてあるので、Biomeを知らないエディタでも同じ結果になります。`biome.jsonc` に残っているのは `.editorconfig` では言えないものと、`entrypoints/content/style.css` の例外1つ（ここでの `!important` は間違いではなく設計そのものです）。

## ビルドとテスト

```powershell
npm run build
```

`.output\chrome-mv3-release` へ出力し、生成manifestがソースの宣言どおりかを確認します＝権限と署名鍵と名前は `wxt.config.ts`、対象ホストは `utils/site-matches.ts`、バージョンは `package.json`、そしてcontent scriptがmanifestに載っていること。`.output\chrome-mv3` は書き換えません。

```powershell
npm run build:firefox
```

同じビルドと同じ確認をFirefox向けに、`.output\firefox-mv3-release` へ。SiftがFirefoxで動くという主張ではありません＝一度も検証していません。`wxt.config.ts` がFirefoxのMV2フォールバックを避けるために `manifestVersion` を3に固定しており、その判断を触るのはこのビルドだけです。CIが走らせているのも同じ理由です。

```powershell
npm test
```

全体を型検査（`tsc --noEmit`）してから、Vitestで単体テストを実行します。テストファイルは対象コードの隣に置いてあり（`utils/filter-core.test.ts` など）、アダプターは本物のDOMにセレクタを当てて検証します＝テストが書いたマークアップをhappy-domがパースするので、通るということはそのセレクタが実ページでも要素を見つけるということです。型検査だけを走らせるコマンドは別にありません＝これが唯一で、CIも同じものを走らせます。
