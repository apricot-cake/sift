# Chrome ウェブストア掲載情報

## 日本語

### 名前

sift

### 概要

X・Blueskyの投稿をサイドパネルに集め、いいね数や画像の有無で絞り込めます。投稿は新しいタブで開きます。

### 詳細説明

X・Blueskyのタイムラインやリストで、条件に合う投稿をサイドパネルへ集めます。

いいね数や画像・動画の有無で絞り込み、返信・引用・リポストを除外できます。投稿をクリックすると新しいタブで開きます。元ページの表示は変更しません。

使い方: <https://github.com/apricot-cake/sift#使い方>

### カテゴリ

仕事効率化

## English

### Name

sift

### Summary

Collect X and Bluesky posts in a side panel, filter by likes and images, and open posts in new tabs.

### Detailed description

Collect matching posts from supported X and Bluesky timelines and lists in a side panel.

Filter by likes, images or videos, and exclude replies, quotes, and reposts. Click a post to open it in a new tab. The original page stays unchanged.

Usage: <https://github.com/apricot-cake/sift#使い方>

### Category

Productivity

## 対応範囲・掲載画像の確認事項

以下は掲載文とは別の確認事項です。提出前に、実装と掲載内容を照合してください。

- 対象は画面に読み込まれた投稿です。同じ一覧内で最大1,000件を一時保持します。画像の内容は判定せず、元ページの投稿を隠したり並べ替えたりしません。
- 絞り込みはブラウザー内で行い、開発者へのデータ送信は行いません。Chrome の同期ストレージによる設定の同期とは区別してください。
- 掲載画像は架空の投稿による操作デモです。画像内でもデモであることを明示してください。
- パネル一覧への移行後の画像・動画は未作成です。ストアへ提出する前に、旧方式を示す掲載画像を差し替えてください。
- 対応する画面は [対応サービス](../docs/対応サービス.md)と照合してください。

## プライバシー欄

### 単一用途

X・Blueskyでイラストを探すために、読み取った投稿をサイドパネルへ表示します。いいね数、画像・動画の有無、返信・引用・リポストの除外条件でパネル内の一覧を絞り込みます。

### 権限の理由

- `storage`: サイトごとの絞り込み条件を Chrome の同期ストレージに保存するため。接続先タブのURL・識別子と、元の一覧・選択タブを識別する情報、画像拡大中の遷移を確認するための一時的なURLと時刻をセッション中だけ保存します。この接続情報は同期しません。
- `sidePanel`: 閲覧中のページと並べて収集した投稿と絞り込み条件を表示するため。
- `activeTab`: ユーザーが拡張機能のボタンを押した現在のタブだけで、対応画面を判定して投稿を読み取るため。
- `scripting`: `activeTab` で許可された現在のタブへ、投稿を読み取るコードと、パネル開閉時の閲覧位置を保つコードを実行するため。

### リモートコード

使用しません。

### データ利用の申告

- ウェブサイトのコンテンツ: 一覧に必要な投稿URL、投稿者、本文、画像URLと判定値をブラウザー内で一時的に保持します。投稿は永続保存せず、開発者へ送信しません。画像の表示時にはサービスの画像配信元へ通信することがあります。
- ウェブ履歴: 接続先のURLと元の一覧を識別する情報をブラウザー内のセッション中だけ保存します。閲覧履歴の蓄積や外部送信は行いません。
- データの販売、広告利用、第三者提供、人による閲覧: いずれも行いません。
- Limited Use の各項目: 準拠として申告します。

### URL

- ホームページ: <https://github.com/apricot-cake/sift>
- サポート: <https://github.com/apricot-cake/sift/issues>
- プライバシーポリシー: <https://raw.githubusercontent.com/apricot-cake/sift/main/PRIVACY.md>

## 提出前にダッシュボードで決める項目

- 公開範囲と配信地域
- 成人向けコンテンツの指定
- 開発者アカウントの連絡先メールアドレス
- 2段階認証の有効化
