<!-- markdownlint-disable MD025 -- 日本語版と英語版をそれぞれ独立した文書として記載する -->

# Sift プライバシーポリシー

最終更新日: 2026年10月3日

Sift は、ユーザーがツールバーのアイコンを押した対応サイトで、画面に表示された投稿や動画を指定した条件で絞り込む Chrome 拡張機能です。

## 扱うデータ

Sift は、絞り込みに必要な範囲で、対応サイトの投稿や動画の反応数、再生数、公開時期、コンテンツタイプ、返信・引用・リポストの区分、投稿識別子などを読み取ります。ユーザーが Sift を起動した対応サイトのタブで処理し、絞り込みはブラウザー内で完結します。

Bluesky では、サイトがブラウザー内に保存したデータを読み取り、現在のアカウント識別子（DID）と選択フィードを使って、絞り込み対象の一覧を判別します。Sift は、このアカウント識別子を独自の保存先へ保存しません。

この保存データには、メールアドレスや認証トークンが含まれる場合があります。Sift は保存データ全体を読み取って解析しますが、一覧の判別に使うのは DID と選択フィードだけです。読み取った保存データを独自の保存先へ保存したり、認証に利用したり、外部へ送信したりしません。

対応ページの判定と接続維持のために、対象タブの URL を参照します。また、タブ識別子とサイトの origin（プロトコルとドメインなど）を、ブラウザーのセッション中だけ保存します。この接続情報は Chrome の同期対象にはしません。閲覧した投稿や動画の内容を永続保存せず、閲覧履歴を蓄積しません。

絞り込み後の表示位置の維持と連続読み込みのために、スクロール位置やページ内の操作を参照します。操作履歴は保存・送信しません。

サイトごとの絞り込み条件は Chrome の同期ストレージに保存します。Chrome にログインして同期を有効にしている場合、設定は Chrome の機能によって同じアカウントのブラウザー間で同期されることがあります。開発者がこの設定を受信することはありません。

## データの送信と共有

Sift は、閲覧中のページや Bluesky の保存データから読み取った情報を、開発者または第三者のサーバーへ送信しません。保存した絞り込み条件は、Chrome の同期が有効な場合に Google の同期機能で端末外へ送られます。開発者はこれらのデータを受信しません。解析、広告、トラッキングは行わず、データを販売しません。Chrome による設定の同期を除き、第三者へデータを共有しません。

Sift によるデータの利用は、Chrome ウェブストアのユーザーデータポリシーと Limited Use の要件に従い、画面上の投稿や動画を絞り込む機能の提供に限定します。

## 設定の変更

保存した絞り込み条件は、設定画面の「すべての設定をリセット」から既定値に戻せます。

## 問い合わせ

このポリシーに関する問い合わせは、[GitHub Issues](https://github.com/apricot-cake/sift/issues) で受け付けます。

---

# Sift Privacy Policy

Last updated: October 3, 2026

Sift is a Chrome extension that filters posts and videos displayed on supported websites according to conditions selected by the user.

## Data handled by Sift

Sift reads the information needed to filter posts and videos on supported websites, including reaction counts, view counts, publication time, content type, whether an item is a reply, quote post, or repost, and post identifiers. Processing takes place in a supported website tab where the user has activated Sift. Filtering occurs entirely within the browser.

On Bluesky, Sift reads data the website has stored in the browser. It uses the current account identifier (DID) and selected feed to identify the list to filter. Sift does not save this account identifier in its own storage.

This stored data may include email addresses and authentication tokens. Sift reads and parses the entire stored data object, but uses only the DID and selected feed to identify the list. Sift does not save this stored data in its own storage, use it for authentication, or transmit it externally.

Sift reads the target tab's URL to identify supported pages and maintain its connection. It also stores the tab identifier and website origin (including the protocol and domain) for the browser session only. This connection information is not synchronized through Chrome. Sift does not persist viewed post or video content or accumulate browsing history.

Sift reads the scroll position and interactions within the page to maintain the viewing position after filtering and continue loading items. It does not store or transmit an interaction history.

Filtering preferences for each website are stored in Chrome sync storage. If Chrome sync is enabled, Chrome may synchronize these preferences between browsers signed in to the same account. The developer does not receive these preferences.

## Data transmission and sharing

Sift does not transmit information read from pages or Bluesky's stored data to the developer or to third-party servers. When Chrome sync is enabled, saved filtering preferences are sent off the device through Google's synchronization service. The developer does not receive this data. Sift does not use analytics, advertising, or tracking, and does not sell data. Except for preference synchronization by Chrome, Sift does not share data with third parties.

Sift's use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements, and is limited to providing the user-facing filtering feature.

## Changing preferences

Saved filtering preferences can be returned to their defaults with “Reset all settings” on the settings page.

## Contact

Questions about this policy can be submitted through [GitHub Issues](https://github.com/apricot-cake/sift/issues).
