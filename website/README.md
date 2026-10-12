# sift プロダクトページ

AstroとCSSで構築した静的サイトです。操作デモの再生には小さなJavaScriptを使用します。配色と共通部品の見た目はshadcn/uiの標準スタイルに揃えています。

## 開発

Node.js 24.12.0 以上を使用します。拡張機能とは依存とビルドを分けています。

```sh
cd website
npm ci
npm run dev
```

開発サーバーで表示するパスは `/sift/` です。
`/sift/alternative/` でもメインページと同じデザインを表示します。

```sh
npm run check
npm run build
```

`check` はAstroとTypeScriptの診断を実行します。`build` は公開用ファイルを `dist/` に生成し、素材パス、ページ内リンク、GitHubボタンのスタイルを検査します。

## 公開

公開先は <https://apricot-cake.github.io/sift/> です。リポジトリの Settings → Pages → Source を GitHub Actions に設定します。

`.github/workflows/website.yml` がサイトを検査・ビルドします。`main` へのサイト変更の push または手動実行で GitHub Pages に公開します。pull request では検査とビルドだけを行います。

## 操作デモとクレジット

X・Blueskyと動画サイトの操作例を、架空データのHTMLデモで再生します。動画の画面はYouTubeを例にしています。アイコン、パネル、条件選択、絞り込みの各段階をクリックして再生位置を変更できます。選択したサービスの中で繰り返し、設定や操作は保存しません。

クレジットはフッターから別ページへリンクします。

投稿・動画の情報は架空データです。画像の作者と出典はクレジットページに掲載します。
