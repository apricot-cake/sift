// ビルド時に、wxt.config.ts の `define` が Vite の command で分けて boolean の
// リテラルへ畳むもの。WXT が自分で生成するものではない＝WXT のものではなく、
// このプロジェクト自身のビルド時の定数だから。
//
// このファイルに import を置いてはならない＝置くとこれがモジュールになり、
// モジュールの中の `declare const` はグローバルではなくなる。
declare const __SIFT_DEV__: boolean;
