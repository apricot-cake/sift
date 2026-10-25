# sift

X・Blueskyでイラストを探すための Chrome 拡張機能です。いつものタイムラインやリストで、投稿をいいね数や画像の有無で絞り込めます。

## 操作デモ

<!-- markdownlint-disable-next-line MD034 -->
https://github.com/user-attachments/assets/3dea7dd6-4ba6-45ad-9158-cc266b037bcb

権利上の理由から、実際のサービス画面ではなく、架空の投稿を使った再現画面です。

## 主な機能

- 最低いいね数と、画像・動画の有無で投稿を絞り込めます。
- 返信・引用投稿・リポストを除外できます。
- 新しく読み込まれた投稿にも同じ条件を適用します。
- 絞り込み条件はサイトごとに保存します。

対象は画面に読み込まれた投稿です。画像の内容からイラストかどうかを判定する機能はありません。投稿の並び順は変更しません。

## インストール

[Chrome ウェブストア](https://chromewebstore.google.com/detail/sift/jglehalaegleehefcefnfmmbblgkomeh)からインストールします。

## 使い方

1. X または Bluesky の対応するタイムラインやリストを開きます。
2. Chrome のツールバーで sift のアイコンを押し、サイドパネルを開きます。
3. 最低いいね数、コンテンツタイプ、除外条件を選びます。

条件は自動で保存されます。サイドパネルに未接続と表示された場合は、絞り込みたいページのタブで sift のアイコンを押してください。

絞り込みはブラウザー内で行います。投稿の内容を開発者へ送信しません。設定の同期など、扱うデータの詳細は [プライバシーポリシー](PRIVACY.md) をご覧ください。

## 開発者向け

開発環境の準備、テスト、画面の確認方法は[開発ガイド](docs/CONTRIBUTING.md)を参照してください。

不具合の報告、機能の提案、質問は [GitHub Issues](https://github.com/apricot-cake/sift/issues) で受け付けます。修正はプルリクエストで送れます。

脆弱性は [非公開フォーム](https://github.com/apricot-cake/sift/security/advisories/new) から報告してください。

## ライセンス

[MIT License](LICENSE)
