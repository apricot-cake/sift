---
name: sift-development-verification
description: Sift 拡張機能を変更した後、開発サーバーと専用 Chrome プロファイルで実機検証する。UI、挙動、manifest、content script、service worker、開発ビルドを変更するときに使う。
---

# Sift の開発環境で検証する

リポジトリ直下で実行する。

## 事前条件

`node_modules/` が無ければ、実行中の開発版を閉じてから `npm install` を実行する。完了後に検証を始める。

1. `npm run dev` を実行して開発サーバーを起動または再利用する。
2. `npm run dev:browser` を実行して専用 Chrome プロファイルを起動する。ユーザーにブラウザ起動を依頼しない。
3. 専用プロファイルで変更した機能を確認する。日常用プロファイルへ開発ビルドを読み込まない。
4. 開発サーバーを再起動した場合は、拡張機能が再接続するのを待ち、`~\\.sift\\extension-errors.log` の `development link: linked` を確認する。
5. 初回のパッケージ化していない拡張機能の読み込み、または X へのログインが未完了なら、必要なユーザー操作を報告してそこで止める。

`docs/development.md` の「開発サーバー」「開発ビルドの接続状態」「開発用プロファイル」を、操作前に必要な範囲だけ読む。

## 報告

実行したコマンド、確認した経路、結果、未確認の理由を完了報告に残す。
