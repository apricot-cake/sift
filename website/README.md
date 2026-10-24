# sift 紹介ページ

利用者向けの説明を載せる、AstroとCSSで構築した静的サイトです。実際の拡張機能を操作した録画へリンクしています。配色と共通部品の見た目はshadcn/uiの標準スタイルに揃えています。

## 開発

Node.js 24.12.0 以上を使用します。pnpm 12.11.2 を使用します。拡張機能と pnpm workspace を共有し、ビルドは分けています。

```sh
pnpm install --frozen-lockfile
cd website
pnpm run dev
```

開発サーバーで表示するパスは `/sift/` です。
`/sift/alternative/` でもメインページと同じデザインを表示します。

```sh
pnpm run check
pnpm run build
```

`check` はAstroとTypeScriptの診断を実行します。`build` は公開用ファイルを `dist/` に生成し、素材パス、ページ内リンク、GitHubボタンのスタイルを検査します。

## 公開

公開先は <https://apricot-cake.github.io/sift/> です。リポジトリの Settings → Pages → Source を GitHub Actions に設定します。

`.github/workflows/website.yml` がサイトを検査・ビルドします。`main` へのサイト変更の push または手動実行で GitHub Pages に公開します。pull request では検査とビルドだけを行います。

## 操作録画と素材

録画は、実際の拡張機能のパネルで最低いいね数・コンテンツタイプ・リポスト除外を操作したものです。紹介ページの「操作録画を見る」から開けます。動画の公開URLは `src/components/ProductPage.astro` で管理します。

Chrome ウェブストアとGitHubへのリンクに使う公式ブランド素材は、[素材の記録](IMAGE-CREDITS.md)を参照してください。
