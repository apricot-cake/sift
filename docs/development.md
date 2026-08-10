# Sift の開発

開発には、日常用とは別の Chrome プロファイルを使います。日常用のプロファイルには、検証済みのリリースビルドだけを読み込みます。

## Node.js

Node.js 24.12 以降が必要です。`.node-version` と `package.json` の `engines` に必要なバージョンを記載しています。CI は `.node-version` のバージョンを使います。

`scripts/` の TypeScript はビルドせずに Node.js で実行します。Node.js 24.12 で TypeScript の型除去が安定したため、このバージョンを最低要件にしています。

## 依存関係

`package.json` の依存関係はすべて完全なバージョンで固定しています。`.npmrc` の `save-exact=true` により、`npm install` が範囲指定へ書き換えることはありません。更新は Dependabot のプルリクエストで受け取ります。ワークフローの `uses:` もコミット SHA で固定しています。

## 開発サーバー

```powershell
npm run dev
```

開発ビルドは `~\.sift-dev\chrome-mv3-dev` に出力します。出力先はすべての worktree で共通です。サーバーは `127.0.0.1:51732` で待ち受けます。ポートが使用中の場合は、別のポートへ移らずに失敗します。拡張機能がこのアドレスを使用するため、同時に起動できる開発サーバーは 1 つです。

## 開発ビルドの接続状態

開発ビルドの content script は manifest に含めません。service worker が開発サーバーへ接続した後、`browser.scripting.registerContentScripts()` で登録します。接続していない service worker では content script は動作しません。

WXT は service worker の起動時に 1 回だけ開発サーバーへ接続します。ブラウザを先に起動した場合や、開発サーバーを再起動した場合は接続が切れたままになります。開発ビルドは 5 秒ごとに接続状態を確認し、起動時と異なるサーバーまたは未登録の状態を検出すると `browser.runtime.reload()` で復帰します。出力フォルダの書き込みが終わるまではリロードしません。空のフォルダをリロードすると、拡張機能が読み込み解除されるためです。

接続状態は `~\.sift\extension-errors.log` の `"kind":"dev-link"` 行で確認できます。ログは開発サーバーに書き込むため、サーバーが停止している間は記録されません。リリースビルドはこのログを書き込みません。

- `development link: linked`: 接続と登録が完了している
- `development link: building`: サーバーは起動しているが、ビルドが完了していない
- `development link: adopt`: 新しいサーバーへ接続した
- `development link: reload`: 復帰のために拡張機能をリロードした
- `content script started on <URL>`: content script を対象ページに登録した
- `filter pass: <n> hit, <n> rising, <n> hidden, toolbar mounted`: 最初の判定を完了し、ツールバーを表示した

## 開発用プロファイル

```powershell
npm run dev:browser
```

専用の `--user-data-dir` で Chrome を開きます。日常用の Chrome とは別プロセスで、同時に利用できます。初回だけ `chrome://extensions` から `~\.sift-dev\chrome-mv3-dev` を読み込み、X にログインしてください。以後はプロファイルが設定を保存します。

service worker を変更した場合は、`chrome://extensions` で拡張機能をリロードします。開発用プロファイルのウィンドウで `Alt+R` を押してもリロードできます。

開発ビルドとリリースビルドは同じ拡張機能 ID を使うため、同じプロファイルには読み込めません。開発ビルドを日常用プロファイルに読み込まないでください。

パスだけを確認する場合は、次のコマンドを実行します。ブラウザは起動しません。

```powershell
node scripts/dev-browser.ts --print
```

## 日常用 Chrome に反映する

`main` へマージすると、`post-merge` フックが `npm run deploy` を実行し、検証済みのリリースビルドを `.output\chrome-mv3` に配置します。フックは `npm install` 時に `scripts/setup.ts` が設定します。手動で反映する場合は、次のコマンドを実行します。

```powershell
npm run deploy
```

検証に失敗した場合は、配置を更新しません。日常用 Chrome は以前のビルドを使い続けます。リンクされた worktree からは配置しません。

## 未捕捉例外の記録

拡張機能は未捕捉例外を `browser.storage.local` の環状バッファに最大 50 件保存します。この処理はリリースビルドにも含まれます。開発ビルドでは、service worker がバッファを開発サーバーへ送信し、`~\.sift\extension-errors.log` に JSON Lines 形式で追記します。

日常用プロファイルのバッファを読み出す手段はありません。content script は拡張機能が発生元と分かる例外だけを記録します。popup、設定画面、service worker はすべての未捕捉例外を記録します。

## 文言

利用者に表示する文言は `locales/<言語>.yml` にあります。`@wxt-dev/i18n` はビルド時に各ファイルから `_locales/<言語>/messages.json` を生成します。対象言語は `en`、`ja`、`ko`、`zh-TW`、`zh-CN`、`es`、`pt-BR` です。既定ロケールは `en` です。対応していない言語のブラウザには英語を表示します。

文言は次の 3 つの経路で使用します。

- コードでは `t("name")` を使います。`utils/i18n.ts` は `#i18n` の `i18n.t` を公開します。メッセージ名は `locales/en.yml` から型を生成するため、存在しない名前はコンパイルできません。複数形を持つメッセージは `t("name", 件数)` の形で呼びます。
- `entrypoints/options/index.html` と `entrypoints/popup/index.html` の静的な文言には、`data-i18n`、`data-i18n-placeholder`、`data-i18n-aria-label` を使います。`localizeDocument()` が文言を置き換えます。
- `wxt.config.ts` の manifest では `__MSG_name__` を使います。これは manifest の対応フィールドだけで展開されます。

静的 HTML には、起動前にも読めるように英語の既定文言を書きます。`utils/i18n.test.ts` は、この文言が `locales/en.yml` と一致することを検証します。manifest の説明文は `verify-manifest.ts` が検証します。

`locales/locales.test.ts` は、全言語が同じキーと差し込み数を持つことを検証します。複数形の表現自体は言語ごとに異なるため、比較しません。テストでは `test/i18n.ts` を通じて `locales/en.yml` を読み込み、`browser.i18n.getMessage` の代わりに使います。

## Lint

```powershell
npm run lint
```

Biome はリポジトリ全体の整形、lint、import の順序を検証します。自動修正する場合は次のコマンドを実行します。

```powershell
npm run lint:fix
```

インデント、改行、末尾改行は `.editorconfig` で定義します。Biome を使わないエディタも同じ設定を参照できます。`biome.jsonc` には `.editorconfig` で定義できない設定と、`entrypoints/content/style.css` の `!important` に関する例外だけを置いています。

## ビルドとテスト

Chrome 向けのリリースビルドは、次のコマンドで作成します。

```powershell
npm run build
```

ビルドは `.output\chrome-mv3-release` に出力します。`verify-manifest.ts` は、生成した manifest がソースの宣言と一致することを検証します。検証対象は、`wxt.config.ts` の権限、署名鍵、名前、`utils/site-matches.ts` の対象ホスト、`package.json` のバージョン、content script の登録です。`.output\chrome-mv3` は更新しません。

Firefox 向けのビルドと manifest の検証は、次のコマンドで実行します。

```powershell
npm run build:firefox
```

出力先は `.output\firefox-mv3-release` です。Firefox での動作は検証していません。このビルドは、`wxt.config.ts` で manifest version を 3 に固定した設定を検証するために CI でも実行します。

型検査と単体テストは、次のコマンドで実行します。

```powershell
npm test
```

このコマンドは `tsc --noEmit` の後に Vitest を実行します。テストは対象コードの隣に置きます。アダプターのテストは実際の DOM にセレクタを適用して検証します。型検査だけを実行するコマンドはありません。CI も同じコマンドを使います。

## コミット

コミットの件名には Conventional Commits の type と日本語の要約を使います。

```text
feat: 設定を options ページへ移し、popup は入口だけにする
```

利用できる type は `feat`、`fix`、`refactor`、`chore`、`docs`、`test`、`perf` です。対象を絞る意味がある場合は、`chore(ci):` のようにスコープを付けます。

本文には変更理由を書きます。変更内容は diff で確認できます。以前の実装の問題点や、選択した理由を残してください。

プルリクエストは squash マージします。プルリクエストのタイトルは `main` のコミット件名になり、本文は `git log` から確認できます。どちらもコミットとして読める文章にしてください。

## リリース

バージョンは `package.json` だけで管理します。WXT が生成した manifest にバージョンを反映し、`verify-manifest.ts` が検証します。

`main` へのマージは `post-merge` フックにより日常用 Chrome へ反映されます。バージョンは、利用中のビルドを識別し、タグから同じ状態を取り出すために使います。機能、利用者に見える UI、参照する価値がある修正を加えたときに更新します。マージごとには更新しません。

```powershell
npm version minor --no-git-tag-version
```

`main` はプルリクエストだけを受け付けるため、バージョンの更新では `--no-git-tag-version` を使います。更新はプルリクエストに含め、マージ後のコミットにタグを付けます。

```powershell
git tag v0.2.0
git push origin v0.2.0
```

`CHANGELOG.md` は作成しません。コミットメッセージに変更理由を残し、`git log v0.1.0..v0.2.0` を変更履歴として使います。
