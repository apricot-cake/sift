# Chrome ウェブストア掲載情報

## 日本語

### 名前

sift

### 概要

X・Blueskyでイラストを探すための拡張機能です。投稿をいいね数や画像の有無で絞り込めます。

### 詳細説明

いつものタイムラインで、イラスト探しに集中してみませんか。

画像のある投稿や、いいねの多い投稿に絞って表示できます。

X・Blueskyの対応するタイムラインやリストを開き、sift のボタンを押して条件を選ぶだけです。

紹介ページ: <https://apricot-cake.github.io/sift/>

### カテゴリ

仕事効率化

## English

### Name

sift

### Summary

Find illustrations on X and Bluesky by filtering posts by like count and the presence of images.

### Detailed description

Make room for illustrations in your usual timeline.

Show only posts with images, or narrow the list to posts with more likes.

Open a supported timeline or list on X or Bluesky, click the sift button, and choose your filters.

Usage and demo: <https://apricot-cake.github.io/sift/>

### Category

Productivity

## 対応範囲・掲載画像の確認事項

以下は掲載文とは別に、提出前に照合する。

- 対象は読み込み済みの投稿。画像の内容は判定せず、投稿の並び順も変更しない。
- 絞り込みはブラウザー内で行い、開発者へのデータ送信は行わない。Chrome の同期ストレージによる設定の同期とは区別する。
- 掲載画像は架空の投稿による操作デモ。画像内でもデモであることを明示する。
- 対応する画面は [対応サービス](../docs/対応サービス.md) と照合する。

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
