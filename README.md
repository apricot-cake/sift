# sift

X・Blueskyでイラストを探すための Chrome 拡張機能です。いつものタイムラインやリストで、投稿をいいね数や画像の有無で絞り込めます。

[Chrome ウェブストア](https://chromewebstore.google.com/detail/sift/jglehalaegleehefcefnfmmbblgkomeh) · [使い方・操作デモ](https://apricot-cake.github.io/sift/)

## 主な機能

- 最低いいね数と、画像・動画の有無で投稿を絞り込む。
- 返信・引用投稿・リポストを除外する。
- 新しく読み込まれた投稿にも同じ条件を適用する。
- サイトごとに絞り込み条件を保存する。

対象は画面に読み込まれた投稿です。画像の内容からイラストかどうかを判定する機能はありません。投稿の並び順は変更しません。

## 必要環境とインストール

デスクトップ版 Google Chrome で利用できます。[Chrome ウェブストア](https://chromewebstore.google.com/detail/sift/jglehalaegleehefcefnfmmbblgkomeh)から追加してください。

X・Blueskyの対応する一覧ページで動作します。検索は「最新」が対象です。X の「おすすめ」や個別投稿など、対応していない画面もあります。詳しくは [対応サービス](docs/対応サービス.md) を参照してください。

ソースからビルドして使う場合は、[開発ガイド](docs/CONTRIBUTING.md#chrome-で確認する)に手順があります。

## 使い方

1. X または Bluesky の対応するタイムラインやリストを開きます。
2. Chrome のツールバーで sift のアイコンを押し、サイドパネルを開きます。
3. 最低いいね数、コンテンツタイプ、除外条件を選びます。

条件は自動で保存されます。接続できていない場合は、使いたいタブで sift のアイコンを押してください。

絞り込みはブラウザー内で行います。投稿の内容を開発者へ送信しません。設定の同期など、扱うデータの詳細は [プライバシーポリシー](PRIVACY.md) を参照してください。

## ドキュメント

- [対応サービス](docs/対応サービス.md): 対応する画面と判定上の制約
- [開発ガイド](docs/CONTRIBUTING.md): 環境構築、テスト、Chrome・Storybook での確認
- [ストア提出](docs/ストア提出.md): 提出前の確認、提出フロー、初期設定、提出記録
- [紹介ページの開発](website/README.md): 操作デモと静的サイトの開発・公開
- [プライバシーポリシー](PRIVACY.md): データの利用と保存

## 開発・貢献・問い合わせ

開発には Node.js 24.12 以降と pnpm 12.11.2 を使います。[開発ガイド](docs/CONTRIBUTING.md)に沿って依存関係を準備し、変更後に `pnpm run check` を実行してください。

不具合の報告、機能の提案、質問は [GitHub Issues](https://github.com/apricot-cake/sift/issues) で受け付けます。修正はプルリクエストで送れます。

脆弱性は [非公開フォーム](https://github.com/apricot-cake/sift/security/advisories/new) から報告してください。

## ライセンス

[MIT License](LICENSE)
