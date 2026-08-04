# Security Policy

## Supported versions

Sift is not published to the Chrome Web Store yet; it is installed unpacked from a local build. Security fixes land on `main`, and only the current state of `main` is maintained. Older builds are not patched in parallel.

## Reporting a vulnerability

Please report security issues privately through GitHub, using the **[Report a vulnerability](https://github.com/apricot-cake/sift/security/advisories/new)** button on this repository's Security tab.

**Do not open a regular issue or pull request for a security problem.** Reproduction steps, proof-of-concept code, and details of an unfixed weakness are all things that should stay private until a fix is available.

Useful things to include, as far as you can:

- Which service the page belonged to (X, Bluesky, or a Misskey instance you added)
- The commit you built from, and your OS and Chrome version
- What an attacker gains, and what access they need to get there
- Steps to reproduce

## What to expect

Reports are reviewed privately in a draft security advisory. We will confirm the report, work on a fix there, and coordinate disclosure once a fixed version is available.

We do not commit to a fixed response time or a fixed patch deadline. Whether an advisory is published, and whether a CVE is requested, is decided per case.

## Scope notes

Sift reads the posts already rendered on the page you are looking at, and hides the ones that do not match your settings. It does not scroll for you, does not collect in the background, does not call any unofficial API, and does not store or transmit post content. The only thing it saves is your own settings, in Chrome's sync storage.

Reports that are especially relevant include anything that lets a page reach beyond that: post content leaving the browser, a host gaining the extension's privileges, the extension acting on a site it was not granted, or a Misskey host added by the reader escalating into permissions the reader did not approve.

Vulnerabilities in third-party dependencies should be reported to the project that maintains them. If a dependency issue affects Sift specifically — for example through how we call it — a report here is welcome.

---

# セキュリティポリシー

## サポート対象

Sift はまだ Chrome ウェブストアで配布しておらず、ローカルでビルドしたものを unpacked で読み込む形です。セキュリティ修正は `main` に入り、保守の対象は**現在の `main` のみ**です。それより古いビルドを並行して修正することはありません。

## 脆弱性の報告

セキュリティ上の問題は、このリポジトリの Security タブにある **[Report a vulnerability](https://github.com/apricot-cake/sift/security/advisories/new)** から、非公開で報告してください。

**通常の Issue や Pull Request で報告しないでください。** 再現手順・実証コード・未修正の弱点の詳細は、修正版が出るまで非公開にしておくべきものです。

分かる範囲で、次の情報があると助かります。

- 対象のページがどのサービスのものか（X / Bluesky / 自分で追加した Misskey インスタンス）
- ビルド元のコミットと、OS・Chrome のバージョン
- 攻撃者が何を得られるか、そのために何の権限が必要か
- 再現手順

## 対応の流れ

報告は draft security advisory の中で非公開に確認します。そこで再現を確かめ、修正を進め、修正版が利用可能になってから公開の調整を行います。

初動までの時間や修正期限をあらかじめ約束することはしません。advisory を公開するか、CVE を申請するかは、個別に判断します。

## 対象範囲について

Sift は、開いている画面に既に描画されている投稿を読み、設定に合わないものを隠すだけの拡張です。自動スクロール・バックグラウンド収集・非公式 API の呼び出しは行わず、投稿の内容を保存も送信もしません。保存するのは利用者自身の設定値だけで、置き場は Chrome の同期ストレージです。

特に関係が深いのは、この範囲を超える動きの報告です＝投稿の内容がブラウザの外へ出る、ページ側が拡張の権限を得る、許可していないサイトで拡張が動く、利用者が追加した Misskey ホストが承認していない権限へ広がる、といったものです。

第三者ライブラリの脆弱性は、そのライブラリの開発元へ報告してください。呼び出し方の問題など、Sift 固有の影響がある場合はこちらへの報告も歓迎します。
