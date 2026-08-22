// 設定をどこに置くか。設定が何であるかは utils/settings.ts で、そちらは
// ビルドスクリプトが node で読めるように拡張機能の API を持たないままにしてある。
import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";
import { defaults, normalizeSettings, type Settings } from "./settings.ts";

// 設定1つにつきキー1つだった頃のビルドが書いたキー＝`defaults` のフィールド名。
// 並べ書きせず導いてあるので、この移行が外される前に足された設定も下の移行が
// 拾う。
const LEGACY_KEYS: string[] = [
  ...Object.keys(defaults),
  "enabled",
  "minLikes",
  "risingMinLikes",
  "risingEnabled",
  "risingMaxAgeHours",
  "mediaMode",
  "excludedKeywords",
  "hideReposts",
  "misskeyMinReactions",
  "misskeyRisingMinReactions",
];

// どの画面もこれを読み書きする。設定1つにつきキー1つではなく、1つのキーが
// 1つのオブジェクトを持つ形＝`defaults` は既に `Settings` を導く唯一の宣言で
// あり、設定ごとに `defineItem` を置くと既定値の写しがその隣にもう1組できる。
// 変更が「読み手が既に持っているものへ差分を戻す」ではなく「1つのイベントが値
// 全体を運ぶ」形になる利点もある。
//
// `normalizeSettings()` は今も読み出しのたびに走る。`fallback` が答えるのは
// キーに何も入っていない場合だけで、古いビルドや書きかけの書き込みが残した
// ものについては何も言わない。
export const settingsItem = storage.defineItem<Settings>("sync:settings", {
  fallback: defaults,
  // 設定はかつて sync ストレージの最上位に1つずつ置かれていた。そういうビルドが
  // 残したものを新しい値へ畳み込むのがこれ＝`init` は一度だけ、しかもキーに
  // 何も入っていない間にしか走らない。
  //
  // Sift を動かしているプロファイルが全部この版かそれ以降で立ち上がったら外せる。
  // まだ公開していないので、それは作者の Chrome プロファイル2つと、このリポジトリ
  // を自分でビルドした人だけ。
  init: async () =>
    normalizeSettings(await browser.storage.sync.get(LEGACY_KEYS)),
});
