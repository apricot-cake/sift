# CONTRIBUTING.md

この文書では、開発環境の準備、テスト、Chrome での確認、ストア提出用ビルドについて説明します。対応するサイトと画面は [対応サービス.md](対応サービス.md) を参照してください。

## 開発環境を準備する

Node.js 24.12 以降が必要です。使用するバージョンは `.node-version` と `package.json` に記載しています。

依存関係をインストールします。

```powershell
npm ci
```

`scripts/` の TypeScript は、Node.js の型除去機能を使って直接実行します。

## コードを確認する

一通りの変更が終わったら、次のコマンドを実行します。

```powershell
npm run check
```

このコマンドは Biome、TypeScript、Vitest を順番に実行します。

個別に実行する場合は、次のコマンドを使います。

```powershell
npm run lint
npm run typecheck
npm run test
```

Biome で自動修正する場合は `npm run lint:fix` を実行します。

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
npm run deploy:local
```

このコマンドは `.output\chrome-mv3` を作成して検査した後、再読み込み専用の[ネイティブメッセージングホスト](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)を現在の Windows ユーザーへ登録します。サイドパネルが開いていれば、配備後に拡張機能を再読み込みします。閉じている場合は、次に開いたときに新しいビルドを読み込みます。

登録先が `HKCU` のため、Chrome と同じ Windows ユーザーで実行する必要があります。

専用の Chrome プロファイルを使う場合は、配備後に次のコマンドを実行します。

```powershell
npm run browser:open
```

このコマンドは通常利用する Chrome とは別のプロファイルを開き、`.output\chrome-mv3` を読み込みます。ポートは Chrome が空きポートを自動取得します。専用プロファイルの `DevToolsActivePort` から接続先を読み、応答のブラウザ識別子が一致した場合だけ再利用します。コマンドが終了した後も Chrome は開いたままになります。接続先を表示する場合は、ブラウザーを開かずに次のコマンドを実行します。

```powershell
npm run browser:status
```

`npm run browser:open` を重ねて実行した場合も、起動済みなら二重起動せず終了します。

接続には専用プロファイルとローカルの待受アドレスを使います。[Chrome のリモートデバッグ](https://developer.chrome.com/blog/remote-debugging-port)では、通常利用するプロファイルとは別のデータディレクトリが必要です。

## ストア提出用ZIPを作る

次のコマンドで Chrome ウェブストア提出用の ZIP を作成します。

```powershell
npm run package:store
```

出力先は `.output\store` です。提出用ビルドには、ネイティブメッセージング権限や自動再読み込み処理を含めません。マニフェスト、権限、ロケール、`activeTab` で注入するスクリプトも生成後に検査します。

## UIテキストを変更する

利用者に表示するテキストは `locales/en.yml` と `locales/ja.yml` にあります。既定の言語は英語です。

React から使う場合は `t("name")` を呼びます。静的 HTML では `data-i18n`、`data-i18n-placeholder`、`data-i18n-aria-label` を使います。マニフェストでは `__MSG_name__` を使います。

日本語と英語のメッセージ名や置換文字列が一致しているかは、自動テストで検査します。

## 依存関係を更新する

依存関係のバージョンは `package.json` で固定しています。更新は Dependabot のプルリクエストで受け取ります。GitHub Actions のバージョンもコミット SHA で固定しています。

## シークレットスキャン

シークレットは GitHub Actions で検査します。Gitleaks は CI 内でのみ実行します。

`.gitleaksignore` では、過去の `wxt.config.js` と `wxt.config.ts` に含まれる Chrome マニフェストの公開鍵について、検出されたコミットと行を指定して除外しています。この値は秘密鍵や認証情報ではありません。
