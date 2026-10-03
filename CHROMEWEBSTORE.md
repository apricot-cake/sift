# Chrome ウェブストア提出前の確認

最終確認日: 2026年10月3日

## 確認範囲

対象は Sift のストア提出用ビルド、バージョン `0.1.5`。`wxt.config.ts`、生成済みの `.output/store/chrome-mv3/manifest.json`、`locales/ja.yml`、`PRIVACY.md`、バックグラウンドとサイト別アダプター、設定の保存処理を静的に確認した。

ユーザーが2026年10月3日に保存した開発者ダッシュボードの「ストアの掲載情報.html」「プライバシー.html」と照合した。入力文、入力欄の値、チェック状態を取得できた。掲載情報は英語が選択されており、日本語の詳細説明は保存されていない。保存 HTML は編集画面の状態を示す資料であり、保存済み・公開中の内容と一致することまでは確認していない。

実機動作、スクリーンショットの内容、審査合格はこの確認の対象外。下記の修正と未確認項目を解消するまで、提出準備が完了したとは扱わない。

## 保存 HTML との照合結果

| 項目 | 登録欄の内容 | 判定・次の作業 |
| --- | --- | --- |
| 英語の概要 | `locales/en.yml` と一致 | 実装の目的と整合する |
| 英語の詳細説明 | X・Bluesky のいいね数、画像・動画、返信等の除外、YouTube・ニコニコの再生数・公開時期、YouTube のメンバー限定除外 | 記載された機能は実装にある。対応する一覧ページに限ることと、ツールバーから起動する手順を補う |
| 単一用途 | 表示中の投稿・動画を反応数、再生数、公開時期、コンテンツタイプで絞り込む | 実装の目的と整合する |
| `storage` | サイト別の条件を Chrome sync storage に保存する | セッション中の接続先情報の保存も補う |
| `sidePanel` | 閲覧中のページと並べて絞り込み操作を表示する | 実装と整合する |
| 権限欄 | `storage`、`sidePanel`、ホスト権限の理由を表示。`activeTab`・`scripting` の欄はない | 現在の提出用 manifest と異なる。次版の ZIP アップロード後に欄を確認し、権限理由を再照合する。保存 HTML だけではストア側の manifest の内容は確定できない |
| リモートコード | 「使用していません」を選択 | 静的確認結果と整合する |
| データ利用 | 「ウェブサイトのコンテンツ」だけを選択 | コンテンツの選択は整合する。アカウント識別子・認証情報を含む保存データ・接続先 URL の扱いが申告に含まれていない。下記の見直し案に従って更新する |
| データ利用の3つの表明 | 3項目とも選択 | 確認した実装と整合する |
| プライバシーポリシー URL | `https://raw.githubusercontent.com/apricot-cake/sift/main/PRIVACY.md` | HTTP 200 で取得し、改行を正規化してローカル最新版との一致を確認した |

英語の詳細説明への追記案:

```text
Open a supported list page, click the Sift icon in Chrome's toolbar, and adjust filters in the side panel. Filtering is available on supported list pages, rather than every page on each website. Available filters depend on the website and page. Website layout changes may affect filtering.
```

英語の権限理由の修正案。次版のアップロード後に表示される欄に合わせて入力する。

| 権限 | 入力案 |
| --- | --- |
| `storage` | Stores filtering preferences for each supported website in Chrome sync storage. Preferences may sync across browsers when Chrome sync is enabled. Stores the connected tab ID and website origin in session storage to maintain the side panel connection. This connection information is not synchronized. |
| `activeTab` | Provides temporary access to the tab where the user clicks the Sift toolbar icon, so Sift can filter content on a supported website. Sift does not request permanent access to all websites. |
| `scripting` | Injects filtering code and styles included in the extension package into the supported tab activated by the user. The code reads post and video information and hides items that do not match the selected filters. |

データ利用の見直し案。カテゴリへの対応は、公式 FAQ とフォームの定義を実装に照らした判断であり、審査結果を保証するものではない。

| 項目 | 見直し案 |
| --- | --- |
| 個人を特定できる情報 | 選択を推奨。Bluesky のアカウント DID を一覧の判別に使い、メールアドレス等を含み得る保存データ全体を読み取る |
| 認証に関する情報 | 現実装を提出するなら選択を推奨。読み取る `BSKY_STORAGE` に認証トークンが含まれる。トークンを認証に利用・保存・送信する処理は確認していない |
| ウェブ履歴 | 選択を推奨。対象タブの URL を利用し、origin をセッション保存する。閲覧履歴の蓄積や外部送信とは区別する |
| ユーザーのアクティビティ | スクロール位置や入力イベントを表示位置の維持と連続読み込みに使う。操作履歴の記録・送信は確認できず、フォームの「ロギング」と同じとは断定しない。処理内容はポリシーに補足した |

これらは現行ソースの判断。公開版の実装を別途確認せず、公開版にも同じ処理があるとは扱わない。次版の ZIP と合わせて申告を更新する。

## 説明と単一目的

拡張機能名は `Sift`。日本語の短い説明は「SNSや動画サイトの投稿を反応数などで絞り込む拡張機能です。」で、132文字以内。

単一目的の申告案: ユーザーが開いた対応サイトの投稿や動画を、反応数・再生数・公開時期・投稿種別などの条件で絞り込む。

ソース上の対応サイトは YouTube、ニコニコ動画、X、Bluesky。対応サイトのすべてのページが対象ではない。詳細説明では、対応する一覧ページで使うこと、サイトごとに使える条件が異なること、サイト側の表示変更によって読み取りができなくなる場合があることを明示する。「すべての投稿を検索」「全ページで利用可能」「確実に条件どおりに非表示」といった保証は実装から確認できない。

## 権限の申告案

生成済みストア manifest の権限は次の4つ。`tabs`、`host_permissions`、自動実行用 `content_scripts`、`nativeMessaging` は含まれない。`sidePanel` は WXT がサイドパネルのエントリーポイントから生成するため、設定ファイルだけでなく提出物を基準に照合する。

| 権限 | 申告案 | 実装の根拠 |
| --- | --- | --- |
| `storage` | サイト別の絞り込み条件を保存し、Chrome の同期が有効な場合は同じアカウントのブラウザー間で設定を利用します。サイドパネルの接続先を維持するため、対象タブの識別子とサイトの origin をセッション中だけ保存します。 | `utils/settings-storage.ts` の `sync:settings`、`entrypoints/background.ts` の `storage.session` |
| `activeTab` | ユーザーがツールバーの Sift アイコンを押したタブへの一時的なアクセスを取得し、対応サイトの表示内容を絞り込みます。常時すべてのサイトを読み取る権限は要求しません。 | `entrypoints/background.ts` の `action.onClicked` と対応サイト判定 |
| `scripting` | ユーザーが Sift を起動した対応サイトのタブに、パッケージ内の絞り込み処理と表示用スタイルを適用します。投稿・動画の指標を読み取り、条件に合わない項目を非表示にするために使います。 | `scripting.executeScript` と `scripting.insertCSS` |
| `sidePanel` | 閲覧中の投稿や動画を確認しながら、絞り込み条件と接続状態をサイドパネルで表示・変更するために使います。 | `entrypoints/background.ts`、`entrypoints/sidepanel/`、生成 manifest の `side_panel` |

ローカル配備専用の `nativeMessaging` と署名用 `key` はストア提出物に含めない。開発用ビルドを申告やアップロードの対象にしない。

## データ利用の確認

外部に送らない処理も申告対象になり得るため、「開発者がデータを受信しない」と「ユーザーデータを扱わない」は区別する。[ユーザーデータの公式 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、[申告欄の公式説明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)

| データ | 処理・保存・送信 | 申告の判断材料 |
| --- | --- | --- |
| 投稿・動画の指標、公開時期、メディア種別、投稿識別子など | 対応サイトの画面から読み取り、ブラウザー内で絞り込みに使用 | Website content を扱う。ローカル処理であることを理由に未使用とはしない |
| 対象タブの URL、ページ内の位置、サイトの origin、タブ識別子 | 対応ページ判定と接続維持に使用。origin とタブ識別子はセッション保存 | Web history の区分との対応をダッシュボードの現行定義で確認する。閲覧履歴の蓄積や外部送信とは区別する |
| Bluesky の保存データ、現在のアカウント DID と選択フィード | サイトの localStorage にある保存データ全体を解析して DID を取り出し、固定リストとカスタムフィードを判別。アカウント DID を拡張機能の保存先へ書く処理は確認できない | 保存データにはメールアドレスや認証トークンが含まれ得る。Personally identifiable information と Authentication information の申告を見直す |
| サイト別の絞り込み条件 | `chrome.storage.sync` に保存。Chrome の同期が有効なら Google の同期機能で端末外に送られる | 開発者への送信は確認できないが、端末外への送信を一律に否定しない |

実行用ソースには、解析・広告用コードや外部送信用の `fetch`、`XMLHttpRequest`、`sendBeacon` は見つからなかった。ストアビルドはローカル再読み込み用処理を無効にする。これは静的な確認結果であり、通信の実測結果ではない。

個人的な通信、健康、決済、位置情報を機能として収集する処理は確認できない。Bluesky の `BSKY_STORAGE` はオブジェクト全体を読み取ってから DID を参照する。[Bluesky の公式スキーマ](https://github.com/bluesky-social/social-app/blob/main/src/state/persisted/schema.ts) では `session.accounts` に `accessJwt`・`refreshJwt`・メールアドレス等が含まれ、[Web の保存実装](https://github.com/bluesky-social/social-app/blob/main/src/state/persisted/index.web.ts) が同じオブジェクトを `BSKY_STORAGE` に保存する。したがって「認証情報を読み取らない」とは扱えない。実ユーザーの保存データやトークン値は取得していない。

遠隔のコードを読み込んで実行する処理は確認できない。Remote code 欄は「使用しない」を申告案とする。データを販売せず、単一目的以外や信用評価・融資判断に使わないという認証事項は、確認した実装と整合する。[現行ポリシー](https://developer.chrome.com/docs/webstore/program-policies/policies)

## プライバシーポリシーの補足

`PRIVACY.md` の日本語版・英語版を2026年10月3日に更新した。指標のローカル処理、設定の Chrome 同期、開発者への非送信、Limited Use とリセット方法に加え、次の処理を説明している。

1. Bluesky のサイト保存データを参照し、現在のアカウント識別子と選択フィードを一覧の判別に使う。
2. 接続先のタブ識別子とサイトの origin をセッション保存する。閲覧履歴の蓄積とは区別する。
3. Chrome の設定同期による Google への送信を、非送信・非共有の説明の例外として明示する。

保存 HTML に登録された URL の公開本文を取得し、ローカル最新版と一致することを確認した。

## 提出前に残る確認

| 項目 | 状態 |
| --- | --- |
| Manifest V3、権限4つ、署名用 `key`・`nativeMessaging` の除外 | 生成済みストア manifest で確認 |
| 短い説明の文字数と拡張名 | ローカルソースで確認 |
| 現在公開中のバージョンより新しい提出バージョン | ダッシュボードでは公開版 `0.1.5`。現在の package.json も `0.1.5` のため、提出時には新しい版が必要 |
| 説明と実装の一致 | 保存 HTML の英語概要・詳細説明を照合。起動手順と対象ページの制限を補う。日本語詳細説明と公開ページは未確認 |
| 権限理由・データ利用・Remote code の登録内容 | 保存 HTML で確認。次版アップロード後の権限欄とデータ利用申告の見直しが残る |
| プライバシーポリシーの補足と公開 URL | 日本語版・英語版を補足済み。保存 HTML の登録 URL と公開本文を照合済み |
| ストア画像の寸法・現行 UI との一致 | 未確認。ここでは画面撮影・操作を実施していない |
| 提出 ZIP の内容、不要ファイルの除外 | 提出する ZIP ごとに確認 |
| 対応ページでの実機動作と再接続 | この調査では未実施。プロジェクト所定の実機検証が別途必要 |

権限の増減、データの参照・保存・送信の変更、対応ページや UI の変更があれば、この文書と申告・ポリシーを再照合する。ストア審査の結果は審査完了後に確認する。
