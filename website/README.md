# sift 紹介ページ

AstroとCSSで構築した静的サイトです。操作デモの再生には小さなJavaScriptを使用します。配色と共通部品の見た目はshadcn/uiの標準スタイルに揃えています。

## 開発

Node.js 24.12 以降と pnpm 12.11.2 を使います。依存パッケージは拡張機能とまとめて管理し、公開用ファイルは別々に生成します。次のコマンドをリポジトリのルートから実行してください。

```sh
pnpm install --frozen-lockfile
cd website
pnpm run dev
```

開発サーバーが起動したら、表示されたURLの `/sift/` をブラウザーで開いてください。
`/sift/alternative/` でもメインページと同じデザインを表示します。

```sh
pnpm run check
pnpm run build
```

`check` は Astro と TypeScript でコードを検査します。`build` は公開用ファイルを `dist/` に生成し、画像などの参照先、ページ内リンク、GitHub ボタンのスタイルを検査します。

## 公開

公開先は <https://apricot-cake.github.io/sift/> です。初めて公開する場合は、リポジトリの Settings → Pages → Source で GitHub Actions を選んでください。

`.github/workflows/website.yml` がサイトを検査・ビルドします。サイトの変更を `main` へ push するか、ワークフローを手動で実行すると、GitHub Pages に公開します。プルリクエストでは検査とビルドだけを行います。

## 操作デモとクレジット

操作デモでは、架空の投稿を使って X・Bluesky の絞り込み操作を紹介します。アイコン、パネル、条件選択、絞り込みの各段階をクリックして再生位置を変更できます。デモは繰り返し再生します。設定や操作は保存しません。

画像の作者と出典は、ページ下部から開けるクレジットページに掲載します。使用する素材の記録は [画像素材の記録](IMAGE-CREDITS.md)をご覧ください。
