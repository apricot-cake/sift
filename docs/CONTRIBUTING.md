# CONTRIBUTING.md

この文書では、開発環境の準備、テスト、Chrome での確認、ストア提出用ビルドについて説明します。対応するサイトと画面は [対応サービス.md](対応サービス.md) を参照してください。

## 開発環境を準備する

Node.js 24.12 以降が必要です。使用するバージョンは `.node-version` と `package.json` に記載しています。

依存関係をインストールします。

```powershell
npm ci
```

`scripts/` の TypeScript は、Node.js の型除去機能を使って直接実行します。

スペル検査には [typos](https://github.com/crate-ci/typos) 1.49.0 を使います。公式リリースの実行ファイルを PATH に追加するか、Rust の Cargo でインストールしてください。CI も同じバージョンを使います。

```powershell
cargo install typos-cli --version 1.49.0 --locked
```

## コードを確認する

一通りの変更が終わったら、次のコマンドを実行します。

```powershell
npm run check
```

このコマンドは Biome、markdownlint、typos、TypeScript、Vitest を順番に実行します。

個別に実行する場合は、次のコマンドを使います。

```powershell
npm run lint
npm run lint:code
npm run lint:markdown
npm run lint:typos
npm run typecheck
npm run test
```

Biome で自動修正する場合は `npm run lint:fix` を実行します。

Markdown の自動修正には `npm run lint:markdown:fix` を使います。設定は `.markdownlint-cli2.jsonc` にあり、日本語の段落を機械的に改行しないため、行長制限を無効にしています。文書固有の例外は、その文書のコメントに理由を記載します。

typos の設定は `_typos.toml` にあります。生成物・依存ファイルを除外し、誤検知は識別子や単語単位で許可します。検査の対象となる文章やコードを、警告を消す目的で丸ごと除外しないでください。

自動テストでは、保存した HTML fixture を使って、各対応サイトのセレクター、対象判定、投稿情報の読み取りを検証します。fixture は `test/fixtures/adapters` にあります。実サイトで DOM 変更を見つけた場合は、必要な構造だけを fixture に追加して失敗するテストを作り、それからアダプターを修正します。

## Chrome で確認する

次のコマンドで本番ビルドを作成します。

```powershell
npm run build
```

出力先は `.output\store\chrome-mv3` です。Chrome の拡張機能管理画面でデベロッパーモードを有効にし、このフォルダーを「パッケージ化されていない拡張機能」として読み込みます。

コードを変更した後は、もう一度 `npm run build` を実行し、拡張機能管理画面で再読み込みします。

### 自動再読み込みを使う

Windows では、ローカル配備用のビルドを自動で再読み込みできます。この機能は任意です。

```powershell
npm run build:candidate
npm run verify:candidate
npm run deploy:local
npm run browser:open
```

候補は `.output\candidate\chrome-mv3` に作成します。各検証コマンドは専用プロファイルの Chrome を起動して候補を自動で読み込み、終了処理で Chrome を閉じます。手動確認用の開発用 Chrome が開いている場合は、先に閉じてください。全検証が成功した後、`deploy:local` が同じ成果物を `.output\chrome-mv3` へ配備します。検証後にソースや成果物が変更された場合は配備できません。

候補の読み込みだけを確認する場合は、`npm run browser:candidate` を実行できます。全検証の前にこのコマンドを実行する必要はありません。

配備時に再読み込み専用の[ネイティブメッセージングホスト](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)を現在の Windows ユーザーへ登録します。サイドパネルが開いていれば、配備後に拡張機能を再読み込みします。閉じている場合は、次に開いたときに新しいビルドを読み込みます。

登録先が `HKCU` のため、Chrome と同じ Windows ユーザーで実行する必要があります。

手動確認には、次のコマンドで専用の Chrome プロファイルを開きます。

```powershell
npm run browser:open
```

`browser:open` は CDP ポートを開かずに Chrome を起動し、候補を読み込みます。事前に `build:candidate` を実行してください。コマンドが終了した後も Chrome は開いたままになります。候補を読み込むため、バックグラウンドの保持プロセスが Playwright の pipe 接続を維持します。Chrome のウィンドウを閉じると、保持プロセスも終了します。

自動検証と同じプロファイルを使い、前回のタブを復元するので、ログイン状態を引き継げます。開発用 Chrome が既に開いている場合は、プロファイルの競合を避けるため起動をエラーにします。閉じてから再実行してください。

`test:live`、`smoke:panel`、`smoke:connection`、`browser:candidate` は、実行中だけローカル CDP ポートを有効にします。`verify:candidate` は全検証を通して1つの Chrome を共有します。正常終了・検証失敗のどちらでも、終了処理で Chrome を閉じます。プロセスの強制終了で終了処理が実行されなかった場合は、残った開発用 Chrome を閉じてください。再検証するときは同じコマンドを実行し、終了後に手動確認する場合は `browser:open` で開き直してください。

CDP ポートを有効にしたセッションが実行中の場合だけ、次のコマンドで TCP の接続先を表示できます。このコマンドは Chrome を起動しません。

```powershell
npm run browser:status
```

自動検証の接続には専用プロファイルとローカルの待受アドレスを使い、ポートは Chrome が選びます。[Chrome のリモートデバッグ](https://developer.chrome.com/blog/remote-debugging-port)では、通常利用するプロファイルとは別のデータディレクトリが必要です。検証中はローカルプロセスから CDP に接続できるため、この方式は接続の有効期間を限定する対策です。

## ストア提出用ZIPを作る

次のコマンドで Chrome ウェブストア提出用の ZIP を作成します。

```powershell
npm run package:store
```

出力先は `.output\store` です。提出用ビルドには、ネイティブメッセージング権限や自動再読み込み処理を含めません。マニフェスト、権限、ロケール、`activeTab` で注入するスクリプトも生成後に検査します。

GitHub Actions からアップロードと審査提出を行う手順は [ストア提出](ストア提出.md) を参照してください。

## UIテキストを変更する

利用者に表示するテキストは `locales/en.yml` と `locales/ja.yml` にあります。既定の言語は英語です。

React から使う場合は `t("name")` を呼びます。静的 HTML では `data-i18n`、`data-i18n-placeholder`、`data-i18n-aria-label` を使います。マニフェストでは `__MSG_name__` を使います。

日本語と英語のメッセージ名や置換文字列が一致しているかは、自動テストで検査します。

## 依存関係を更新する

依存関係のバージョンは `package.json` で固定しています。更新は Dependabot のプルリクエストで受け取ります。GitHub Actions のバージョンもコミット SHA で固定しています。

プルリクエストでは Dependency review が依存関係の変更を検査します。本番用・開発用・用途不明の依存を対象とし、重大度 low 以上の既知の脆弱性を含む依存が追加されると CI が失敗します。検出結果は「依存関係レビュー」ジョブの実行結果で確認してください。

ライセンス情報は同じジョブの実行結果で確認できます。ライセンスの許可リストは設定していないため、ライセンスによる合否判定は行いません。

## シークレットスキャン

シークレットは GitHub Actions で検査します。

`.gitleaksignore` では、過去の `wxt.config.js` と `wxt.config.ts` に含まれる Chrome マニフェストの公開鍵について、検出されたコミットと行を指定して除外しています。この値は秘密鍵や認証情報ではありません。
