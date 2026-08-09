// misskey.io だけが持つ、ビルド時に確定した特別扱い（#41）。他の Misskey ホストは
// 利用者が実行時に1つずつ追加する（utils/instances.ts）が、misskey.io は突出した
// 利用者数を理由に host_permissions へ静的に含め、content script も静的な
// matches（utils/site-matches.ts）で届ける＝インストール直後から追加操作なしに
// 動く。
//
// この一覧を要る場所は3つ（wxt.config.ts の host_permissions、
// utils/site-matches.ts の content script の matches、設定画面の「削除できない
// 既定のホスト」の表示）あり、どれも同じ答えを持たなければならないので1箇所に
// してある。utils/instances.ts に置かないのは、あちらが読み手の実行時の追加・
// 削除だけを扱う場所だから＝ここのホストはどちらの操作の対象にもならない。
export const DEFAULT_MISSKEY_HOSTS: readonly string[] = Object.freeze([
  "misskey.io",
]);
