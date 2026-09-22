# 開発ガイド

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
npm test
```

Biome で自動修正する場合は `npm run lint:fix` を実行します。

自動テストでは、保存した HTML を使ってセレクターと判定処理を検証します。実際のサイトとの互換性は、各サイトが表示したページを Chrome で確認します。

## ブラウザ E2E を確認する

ブラウザと拡張機能の接続は、専用の開発用 Chrome プロファイルで確認します。日常利用の Chrome や、画面・入力を使う自動操作は使いません。

```powershell
npm run deploy
npm run dev:browser
npm run test:e2e:browser
```

`npm run test:e2e:browser` は、実在する対応サイトと対象外ページを開き、拡張機能の action を実行して、対象判定、サイドパネルの有効化、設定の反映を確認します。検証中に変更した設定は終了時に戻します。

GitHub Actions では、`main` への push 後に認証不要の YouTube ページで E2E を実行します。仮想画面上で開いた Chrome とサイドパネルのスクリーンショットを artifact として 14 日間保存します。スクリーンショットの差分比較は行いません。

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
npm run deploy
```

このコマンドは `.output\chrome-mv3` を作成して検査した後、再読み込み専用の[ネイティブメッセージングホスト](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)を現在の Windows ユーザーへ登録します。サイドパネルが開いていれば、配備後に拡張機能を再読み込みします。閉じている場合は、次に開いたときに新しいビルドを読み込みます。

登録先が `HKCU` のため、Chrome と同じ Windows ユーザーで実行する必要があります。

専用の Chrome プロファイルを使う場合は、配備後に次のコマンドを実行します。

```powershell
npm run dev:browser
```

このコマンドは通常利用する Chrome とは別のプロファイルを開き、`.output\chrome-mv3` を読み込みます。ポートは Chrome が空きポートを自動取得します。専用プロファイルの `DevToolsActivePort` から接続先を読み、応答のブラウザ識別子が一致した場合だけ再利用します。コマンドが終了した後も Chrome は開いたままになります。接続先を表示する場合は、ブラウザーを開かずに次のコマンドを実行します。

```powershell
node scripts/dev-browser.ts --print
```

開発用 Chrome で対応サイトを開いた後、別のターミナルから確認を実行できます。

```powershell
npm run verify:browser
```

このコマンドも専用プロファイルから同じ CDP 接続先を自動取得し、配備済みビルドの読み込み、対応サイトの再読み込み、サイドパネル操作を実行して終了します。開いている Chrome は維持します。`npm run dev:browser` を重ねて実行した場合も、起動済みなら二重起動せず終了します。

接続には専用プロファイルとローカルの待受アドレスを使います。[Chrome のリモートデバッグ](https://developer.chrome.com/blog/remote-debugging-port)では、通常利用するプロファイルとは別のデータディレクトリが必要です。

## ストア提出用ZIPを作る

次のコマンドで Chrome ウェブストア提出用の ZIP を作成します。

```powershell
npm run zip:store
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
