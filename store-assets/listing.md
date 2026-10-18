# Chrome ウェブストア掲載情報

## 日本語

### 名前

sift

### 概要

X・Blueskyでイラストを探すためのSNSイラストフィルター。いいね数や画像の有無、返信・引用・リポストの除外で投稿を絞り込めます。

### 詳細説明

sift は、X・Blueskyでイラストを探すためのSNSイラストフィルターです。タイムラインやリストに表示された投稿を、いいね数や画像の有無で絞り込む Chrome 拡張機能です。拡張機能のボタンからサイドパネルを開き、現在のサイトに適用する条件を設定します。

- X と Bluesky: 最低いいね数、画像・動画の有無、返信・引用・リポストの除外
- 新しく読み込まれた投稿にも同じ条件を適用
- サイトごとに条件を保存

画像の内容からイラストかどうかを自動判定する機能はありません。対応する一覧ページで、読み込まれた投稿を絞り込みます。サイトの並び順は変更しません。

判定はブラウザー内で行います。開発者へのデータ送信、解析、広告、トラッキングは行いません。

掲載画像には架空の投稿を使った操作デモを使用しています。

### カテゴリ

仕事効率化

## English

### Name

sift

### Summary

An illustration filter for X and Bluesky. Filter posts by likes, images, and exclusions for replies, quotes, and reposts.

### Detailed description

sift is a social media illustration filter for finding illustrations on X and Bluesky. It filters posts in timelines and lists by like count and the presence of images or videos. Open the side panel from the extension button and choose the conditions for the current website.

- X and Bluesky: minimum likes, image or video content, and exclusions for replies, quote posts, and reposts
- Applies the same conditions to newly loaded posts
- Saves separate preferences for each website

sift does not analyze images to determine whether they are illustrations. It filters loaded posts on supported list pages without changing the website's sort order.

All filtering happens within the browser. sift does not send data to the developer or use analytics, advertising, or tracking.

The screenshots show an operation demo with fictional posts.

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
