<p align="center"><a href="README.md">English</a> ・ <strong>日本語</strong></p>

# Sift

XとBlueskyの投稿画面に読み込まれた投稿をブラウザ内で絞り込むChrome拡張です。

> [!WARNING]
> **まだリリース前です。** Chromeウェブストアでは配布しておらず、使うにはこのリポジトリを自分でビルドして読み込む必要があります。壊れる変更が予告なく入り、保存済みの設定値が初期値へ戻ることがあります。対応サービスの画面構造が変わると、更新するまで判定が効かなくなります。

初期設定は次のとおりです。値は拡張機能のアイコン、または投稿画面右下の「設定」から変更できます。

- 通常: 画像または動画があり、500いいね以上
- 上昇中: 画像または動画があり、投稿後6時間以内、100いいね以上
- リポストを除外

## インストール

```powershell
npm install
npm run deploy
```

`chrome://extensions` から `.output\chrome-mv3` をパッケージ化されていない拡張機能として読み込み、XまたはBlueskyで投稿が並ぶ画面を開きます。右下に抽出状況が表示されます（青い線＝通常、橙色の線＝上昇中）。

`.output\chrome-mv3` は検証済みのrelease専用です。開発中のビルドはここへ出ません。

## 仕組みと制約

- 現在開いている画面に読み込まれた投稿だけを判定します。自動スクロール、バックグラウンド収集、非公式API呼び出しは行いません。
- 投稿データは保存・送信しません。設定値だけをChromeの同期ストレージへ保存します。
- 非公開投稿、ブロック、地域制限など、開いている画面自体に届かない投稿は表示できません。

### 対応サービス

判定条件と設定値はサービス間で共有します。Blueskyのいいねにも Xと同じしきい値を使います。

| | X | Bluesky |
| --- | --- | --- |
| 対象ホスト | `x.com` / `twitter.com` | `bsky.app` |
| 反応の数 | いいね | いいね |
| 共有の除外 | リポスト | リポスト |

Blueskyの制約:

- 対象はホーム、プロフィール、フィード、リスト、投稿詳細です。通知画面では投稿の行だけを判定します。
- 検索結果は対象外です。検索結果の投稿だけは他の画面と違う作りで描かれるためです。
- 投稿時刻は投稿のURLから読み取ります。読み取れない場合は「上昇中」の判定だけを止め、通常の判定は動かします。
- リポストは画面上の文言でなく作りで判定します。Bluesky側でこの作りが変わると、除外が効かなくなる可能性があります。

### Misskeyインスタンスの追加

Misskeyは使うインスタンスが利用者ごとに違うため、追加したインスタンスだけへアクセスします。拡張機能のアイコンから開く設定画面でホスト名（例: `misskey.io`）を追加すると、Chromeの権限ダイアログでそのホストだけへの許可を確認し、許可した場合にだけcontent scriptを読み込みます。削除すると、content scriptの登録とアクセス許可の両方を外します。

現時点ではMisskeyの投稿を読み取るアダプターが無いため、判定やツールバーはまだ表示されません。

## 開発

開発は日常のChromeとは別のプロファイルで行います。日常のChromeには検証済みのreleaseだけを載せます。

### 開発サーバー

```powershell
npm run dev
```

出力先は `~\.sift-dev\chrome-mv3-dev` に固定してあり、どのworktreeから起こしても同じ場所に出ます。待ち受けは `127.0.0.1:51732` だけで、ポートが使用中でも別のポートへは移らず失敗します（拡張がこのアドレス向けにビルドされるため）。同時に起こせる開発サーバーは1つだけです。

### 開発ビルドと開発サーバーのつながり

開発ビルドのcontent scriptはmanifestに載っていません。service workerが開発サーバーへ接続した後に `chrome.scripting.registerContentScripts()` で登録するため、つながっていないworkerではcontent scriptが動きません。

WXTがソケットを張るのはworkerの起動時に1回だけです。開発サーバーより先にブラウザが起きていた場合や、サーバーを起こし直した場合は切れたままになりますが、開発ビルドはこれを自分で検出します。workerが5秒ごとにサーバーへ問い合わせ、起動時と違うサーバー（または未登録の状態）を見つけると `chrome.runtime.reload()` で復帰します。出力フォルダへビルドが書き終わるまでは待ちます（空のフォルダをリロードすると拡張が読み込み解除されるため）。

状態は `~\.sift\extension-errors.log` の `"kind":"dev-link"` 行で読めます。書く先が開発サーバーなので、サーバーが落ちている間は何も出ません。developmentビルドだけが書きます。

- `development link: linked` — つながっていて登録もある
- `development link: building` — サーバーは居るがビルドがまだ
- `development link: adopt` — 新しいサーバーにつながった
- `development link: reload` — 復帰のため自分を起動し直した
- `content script started on <URL>` — そのページにcontent scriptが入った
- `filter pass: <n> hit, <n> rising, <n> hidden, toolbar mounted` — 最初の判定が通りツールバーが出た

### 開発プロファイル

```powershell
npm run dev:browser
```

専用の `--user-data-dir` でChromeを開きます。日常のChromeとは別プロセスで、並べて使えます。初回だけ `chrome://extensions` から `~\.sift-dev\chrome-mv3-dev` を読み込み、Xへログインします。以後はプロファイルが覚えます。

service workerの中身を差し替えたときだけ、`chrome://extensions` のリロード（または開発プロファイルのウィンドウで `Alt+R`）を1回押します。

developmentとreleaseは同じ拡張IDを持つため、同じプロファイルには同居できません。開発ビルドを日常のプロファイルへ読み込まないでください。

パスの確認だけなら `node scripts/dev-browser.ts --print` がウィンドウを開かずに解決結果を表示します。

### 日常Chromeへの反映

mainへマージすると `post-merge` フックが `npm run deploy` を走らせ、検証済みのreleaseを `.output\chrome-mv3` へ差し替えます（フックは `npm install` 時に `scripts/setup.ts` が設定します）。手で走らせることもできます。

```powershell
npm run deploy
```

検証を通らなかったときは差し替えず、日常のChromeは前の版のまま動き続けます。リンクされたworktreeでは差し替えません。

### 未捕捉例外の記録

コードが受け止めそこねた例外は拡張自身が捕まえ、`chrome.storage.local` の環状バッファ（新しい50件）へ書きます。捕まえる側はreleaseにも入っています。developmentビルドでは、service workerがバッファを開発サーバーへ送り、`~\.sift\extension-errors.log` へ1行1件のJSONで追記します。

日常側のバッファを読み出す口はまだありません。content scriptは発生元が拡張と分かる例外だけを、popupとservice workerは全件を記録します。

### ビルドとテスト

```powershell
npm run build
```

`.output\chrome-mv3-release` へ出力し、生成manifestを `manifest.legacy.json` の権限・対象ホスト・content script設定と比較します。`.output\chrome-mv3` は書き換えません。

```powershell
npm test
```

判定ロジックとエラーログの単体テストを実行します。
