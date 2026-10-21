# Chrome ウェブストア掲載情報

## 日本語

### 名前

sift

### 概要

X・Blueskyでイラストを探すための拡張機能です。投稿をいいね数や画像の有無で絞り込めます。

### 詳細説明

対応するタイムラインやリストで、拡張機能のボタンを押して条件を設定します。

- 最低いいね数、画像・動画の有無、返信・引用・リポストの除外
- 新しく読み込まれた投稿にも同じ条件を適用
- サイトごとに条件を保存

読み込み済みの投稿が対象です。画像の内容は判定せず、投稿の並び順も変更しません。

絞り込みはブラウザー内で行い、開発者へのデータ送信は行いません。

掲載画像は架空の投稿による操作デモです。

使い方・操作デモ: <https://apricot-cake.github.io/sift/>

### カテゴリ

仕事効率化

## English

### Name

sift

### Summary

Find illustrations on X and Bluesky by filtering posts by like count and the presence of images.

### Detailed description

On a supported timeline or list, open the side panel from the extension button and choose your filtering conditions.

- Minimum likes, image or video content, and exclusions for replies, quote posts, and reposts
- Applies the same conditions to newly loaded posts
- Saves separate preferences for each website

Only loaded posts are filtered. sift does not analyze image content or change the order of posts.

Filtering happens within the browser. No data is sent to the developer.

The screenshots show an operation demo with fictional posts.

Usage and demo: <https://apricot-cake.github.io/sift/>

### Category

Productivity

## プライバシー欄

### 単一用途

X・Blueskyでイラストを探すために、表示された投稿をいいね数、画像・動画の有無、返信・引用・リポストの除外で絞り込みます。

### 権限の理由

- `storage`: サイトごとの絞り込み条件を Chrome の同期ストレージに保存するため。接続先タブのURL・識別子と、元の一覧・選択タブを識別する情報、画像拡大中の遷移を確認するための一時的なURLと時刻をセッション中だけ保存します。この接続情報は同期しません。
- `sidePanel`: 閲覧中のページと並べて絞り込み条件を操作するため。
- `activeTab`: ユーザーが拡張機能のボタンを押した現在のタブだけで、対応画面を判定して絞り込みを開始するため。
- `scripting`: `activeTab` で許可された現在のタブへ、絞り込み用のコードとスタイルを注入するため。

### リモートコード

使用しません。

### データ利用の申告

- ウェブサイトのコンテンツ: 絞り込みに必要な投稿の判定値をブラウザー内で一時的に読み取ります。投稿の内容は永続保存せず、外部送信もしません。
- ウェブ履歴: 接続先のURLと元の一覧を識別する情報をブラウザー内のセッション中だけ保存します。閲覧履歴の蓄積や外部送信は行いません。
- データの販売、広告利用、第三者提供、人による閲覧: いずれも行いません。
- Limited Use の各項目: 準拠として申告します。

### URL

- ホームページ: <https://apricot-cake.github.io/sift/>
- サポート: <https://github.com/apricot-cake/sift/issues>
- プライバシーポリシー: <https://raw.githubusercontent.com/apricot-cake/sift/main/PRIVACY.md>

## 提出前にダッシュボードで決める項目

- 公開範囲と配信地域
- 成人向けコンテンツの指定
- 開発者アカウントの連絡先メールアドレス
- 2段階認証の有効化
