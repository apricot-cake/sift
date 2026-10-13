# Chrome ウェブストア掲載情報

## 日本語

### 名前

sift

### 概要

X・Blueskyの投稿をいいね数などで、YouTube・ニコニコ動画の再生数順の一覧を投稿期間で絞り込めます。

### 詳細説明

sift は、対応サイトの一覧に表示された投稿や動画を、その場で絞り込む Chrome 拡張機能です。拡張機能のボタンからサイドパネルを開き、現在のサイトに適用する条件を設定します。

- X と Bluesky: 最低いいね数、画像・動画の有無、返信・引用・リポストの除外
- YouTube: チャンネルの動画・配信の「人気の動画」を投稿期間で絞り込み
- ニコニコ動画: 投稿動画一覧・キーワード検索の「再生数が多い順」を投稿期間で絞り込み
- 新しく読み込まれた投稿や動画にも同じ条件を適用
- サイトごとに条件を保存

サイトの並び順は変更しません。YouTubeのショート・チャンネル内検索・人気順を確認できない一覧、ニコニコ動画の再生数が多い順以外は対象外です。

判定はブラウザー内で行います。開発者へのデータ送信、解析、広告、トラッキングは行いません。

掲載画像には架空の投稿・動画を使った操作デモを使用しています。

### カテゴリ

仕事効率化

## English

### Name

sift

### Summary

Filter X and Bluesky posts by likes and content type, and popular YouTube and Niconico videos by publication period.

### Detailed description

sift filters posts and videos in supported website lists as you browse. Open the side panel from the extension button and choose the conditions for the current website.

- X and Bluesky: minimum likes, image or video content, and exclusions for replies, quote posts, and reposts
- YouTube: publication period on a channel's Videos and Live tabs sorted by Popular
- Niconico: publication period on uploaded videos and keyword search results sorted by most views
- Applies the same conditions to newly loaded posts and videos
- Saves separate preferences for each website

sift does not change the website's sort order. YouTube Shorts, channel search, and lists without a confirmed Popular order are unsupported. Niconico lists in other sort orders are also unsupported.

All filtering happens within the browser. sift does not send data to the developer or use analytics, advertising, or tracking.

The screenshots show an operation demo with fictional posts and videos.

### Category

Productivity

## プライバシー欄

### 単一用途

対応サイトの画面に表示された投稿や動画を、ユーザーが指定したいいね数、投稿期間、コンテンツタイプなどで絞り込みます。

### 権限の理由

- `storage`: サイトごとの絞り込み条件を Chrome の同期ストレージに保存するため。
- `sidePanel`: 閲覧中のページと並べて絞り込み条件を操作するため。
- `activeTab`: ユーザーが拡張機能のボタンを押した現在のタブだけで、対応画面を判定して絞り込みを開始するため。
- `scripting`: `activeTab` で許可された現在のタブへ、絞り込み用のコードとスタイルを注入するため。

### リモートコード

使用しません。

### データ利用の申告

- ウェブサイトのコンテンツ: 絞り込みに必要な判定値をブラウザー内で一時的に読み取ります。保存や外部送信は行いません。
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
