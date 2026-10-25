# 開発ガイド

この文書では、開発環境の準備、テスト、Chrome での確認、ストア提出用ビルドについて説明します。対応するサイトと画面は [対応サービス](対応サービス.md)をご覧ください。

## 開発環境を準備する

Node.js 24.12 以降が必要です。使用するバージョンは `.node-version` と `package.json` に記載しています。

パッケージ管理には pnpm 12.11.2 を使います。未導入の場合は、[公式のインストール手順](https://pnpm.io/installation)に従って `npx get-pnpm` を実行してください。バージョンはルートの `package.json` の `packageManager` で固定しています。リポジトリのルートで次のコマンドを実行し、依存パッケージをインストールしてください。

```powershell
pnpm install --frozen-lockfile
```

`scripts/` の TypeScript は、Node.js の型除去機能を使って直接実行します。この機能は、TypeScript の型情報を取り除いてコードを実行するものです。

スペル検査には [typos](https://github.com/crate-ci/typos) 1.51.1 を使います。公式リリースの実行ファイルを PATH に追加するか、Rust の Cargo でインストールしてください。CI も同じバージョンを使います。

```powershell
cargo install typos-cli --version 1.51.1 --locked
```

## コードを確認する

変更が終わったら、次のコマンドで検査とテストを実行してください。

```powershell
pnpm run check
```

このコマンドは Biome、markdownlint、typos、TypeScript、Vitest を順番に実行します。

個別に実行する場合は、次のコマンドを使います。

```powershell
pnpm run lint
pnpm run lint:code
pnpm run lint:markdown
pnpm run lint:typos
pnpm run typecheck
pnpm run test
```

Biome で自動修正する場合は `pnpm run lint:fix` を実行します。

Markdown の自動修正には `pnpm run lint:markdown:fix` を使います。設定は `.markdownlint-cli2.jsonc` にあり、日本語の段落を機械的に改行しないため、行長制限を無効にしています。文書固有の例外は、その文書のコメントに理由を記載します。

typos の設定は `_typos.toml` にあります。生成物・依存ファイルを除外し、誤検知は識別子や単語単位で許可します。検査の対象となる文章やコードを、警告を消す目的で丸ごと除外しないでください。

自動テストでは、保存した HTML のテストデータ（fixture）を使って、各対応サイトのセレクター、対象判定、投稿情報の読み取りを検証します。fixture は `test/fixtures/adapters` にあります。実サイトでページ構造（DOM）の変更を見つけた場合は、必要な構造だけを fixture に追加して失敗するテストを作り、それからアダプターを修正します。

## Chrome で確認する

次のコマンドでストア提出用のビルドを作成してください。

```powershell
pnpm run build
```

出力先は `.output\store\chrome-mv3` です。Chrome の拡張機能管理画面でデベロッパーモードを有効にし、このフォルダーを「パッケージ化されていない拡張機能」として読み込んでください。

コードを変更した後は、もう一度 `pnpm run build` を実行し、拡張機能管理画面で再読み込みしてください。

### 自動再読み込みを使う

Windows では、ローカル配備用のビルドを自動で再読み込みできます。この機能は任意です。

```powershell
pnpm run build:candidate
pnpm run verify:candidate
pnpm run browser:open
```

検証するビルドは `.output\candidate\chrome-mv3` に作成します。以降、このビルドを「検証候補」と呼びます。各検証コマンドは専用プロファイルの Chrome を起動して候補を自動で読み込み、終了処理で Chrome を閉じます。手動確認用の開発用 Chrome が開いている場合は、先に閉じてください。

検証候補にはビルド ID を含めますが、普段使うローカル版の更新確認と `nativeMessaging` 権限は含めません。以降、普段使うローカル版を「日常版」と呼びます。日常版の配備 ID が変わっても検証中の拡張機能は再読み込みされません。`deploy:local` は更新確認を有効にした日常版を `.output\local\chrome-mv3` にビルドして配備します。検証候補とその記録は上書きしません。

日常版への配備は、main の主作業ツリーで次のコマンドを実行します。現在のソースをビルドし、Chrome が読み込む `.output\chrome-mv3` へ配置します。

```powershell
pnpm run deploy:local
```

候補の読み込みだけを確認する場合は、`pnpm run browser:candidate` を実行できます。全検証の前にこのコマンドを実行する必要はありません。

配備時に再読み込み専用の[ネイティブメッセージングホスト](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)を現在の Windows ユーザーへ登録します。パネルを開くときと、パネル内の操作を実行する直前に、一度だけ配備済みビルドを問い合わせます。常時接続や定期監視は行いません。パネルを閉じるときの確認も省きます。

新しいビルドがあれば、その操作は実行せず、拡張機能を再読み込みしてパネルを閉じます。拡張アイコンを押して開き直すと、新しいビルドを使えます。パネルを開いたまま配備した場合、次の操作までは自動フィルタリングも旧ビルドで動作します。

登録先が `HKCU` のため、Chrome と同じユーザーで実行してください。

手動確認には、次のコマンドで専用の Chrome プロファイルを開きます。

```powershell
pnpm run browser:open
```

`browser:open` は Puppeteer の pipe 接続で Chrome を起動し、候補を読み込みます。pipe 接続は、通信ポートを開かず、起動元のプログラムからブラウザーを操作する方法です。事前に `build:candidate` を実行してください。コマンドが終了した後も Chrome は開いたままになります。候補を読み込むため、バックグラウンドの保持プロセスが pipe 接続を維持します。Chrome のウィンドウを閉じると、保持プロセスも終了します。

自動検証と同じプロファイルを使うため、保存されたログイン状態を引き継げます。手動確認では前回のタブを復元します。開発用 Chrome が既に開いている場合は、プロファイルの競合を避けるため起動をエラーにします。閉じてから再実行してください。

`smoke:panel`、`smoke:connection`、`browser:candidate` は、それぞれ自分が起動した Chrome を pipe 接続で操作します。`test:live` は Vitest で実行し、テストファイルごとに Chrome を起動して終了処理で閉じます。`verify:candidate` は各検証コマンドを順番に実行します。各起動で同じ開発プロファイルを使い、ログイン状態を引き継ぎます。正常終了・検証失敗のどちらでも、終了処理で Chrome を閉じます。プロセスの強制終了で終了処理が実行されなかった場合は、残った開発用 Chrome を閉じてください。再検証するときは同じコマンドを実行し、終了後に手動確認する場合は `browser:open` で開き直してください。

次のコマンドで開発プロファイルと pipe 接続の設定を表示できます。このコマンドは Chrome を起動せず、起動状況も取得しません。

```powershell
pnpm run browser:status
```

自動検証と手動起動は、専用プロファイルと Puppeteer の `pipe: true` を使います。TCP の CDP ポートは開きません。この接続方法は [Chrome の Puppeteer による拡張機能テスト](https://developer.chrome.com/docs/extensions/how-to/test/puppeteer)で紹介されています。

## ストア提出用ZIPを作る

次のコマンドで Chrome ウェブストア提出用の ZIP を作成してください。

```powershell
pnpm run package:store
```

出力先は `.output\store` です。提出用ビルドには、ネイティブメッセージング権限や自動再読み込み処理を含めません。マニフェスト、権限、ロケール、`activeTab` で注入するスクリプトも生成後に検査します。

GitHub Actions からアップロードと審査提出を行う手順は [ストア提出](ストア提出.md)をご覧ください。

## UIテキストを変更する

利用者に表示するテキストは `locales/en.yml` と `locales/ja.yml` にあります。既定の言語は英語です。

React から使う場合は `t("name")` を呼びます。静的 HTML では `data-i18n`、`data-i18n-placeholder`、`data-i18n-aria-label` を使います。マニフェストでは `__MSG_name__` を使います。

日本語と英語のメッセージ名や置換文字列が一致しているかは、自動テストで検査します。

## 依存関係を更新する

依存関係のバージョンは `package.json` で固定しています。更新は Dependabot のプルリクエストで受け取ります。GitHub Actions のバージョンもコミット SHA で固定しています。

プルリクエストでは Dependency review が依存関係の変更を検査します。本番用・開発用・用途不明の依存パッケージを対象とします。重大度 low 以上の既知の脆弱性を含むパッケージが追加されると、CI が失敗します。検出結果は「依存関係レビュー」ジョブの実行結果で確認してください。

ライセンス情報は同じジョブの実行結果で確認できます。ライセンスの許可リストは設定していないため、ライセンスによる合否判定は行いません。

## 認証情報の混入を検査する

トークンや秘密鍵などの認証情報が含まれていないか、GitHub Actions で検査します。

`.gitleaksignore` では、過去の `wxt.config.js` と `wxt.config.ts` に含まれる Chrome マニフェストの公開鍵について、検出されたコミットと行を指定して除外しています。この値は秘密鍵や認証情報ではありません。

## Storybook で画面を確認する

Storybook は、拡張機能を読み込まずに画面や部品を確認できるプレビューです。`pnpm run storybook` を実行し、ブラウザーで <http://127.0.0.1:6007/> を開いてください。X・Bluesky・未接続・警告の表示と、基本部品を確認できます。

設定変更はプレビュー内のメモリだけに保存されます。表示例（ストーリー）を切り替えると初期化されます。

Codex の内蔵ブラウザーで要素にコメントを付ける場合は、対象のストーリーを選び、ツールバーの「Open canvas in new tab」で単独表示を開いてください。その URL を内蔵ブラウザーで表示し、「Annotate」で要素を選んでコメントを保存すると、チャットで修正を依頼できます。

サイドパネルの単独表示 URL は <http://127.0.0.1:6007/iframe.html?id=サイドパネル--x&viewMode=story> です。

`pnpm run build:storybook` で、配信用の静的ファイルを `.output/storybook` に出力できます。Storybook で確認できるのは画面と操作のプレビューです。サイト上の絞り込みや拡張機能の権限は、別途実機で確認してください。
