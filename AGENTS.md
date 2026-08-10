# Git

`main` に入る変更は、必ずプルリクエスト経由で取り込む。書き込みを始める時に
`main` を checkout している場合は、変更前に作業ブランチを作る。変更の公開先は
作業ブランチとし、プルリクエストを作成する。

## 開発検証

拡張機能の UI、挙動、manifest、content script、service worker、または開発ビルドを変更したら、完了前に `sift-development-verification` スキルを必ず使う。
