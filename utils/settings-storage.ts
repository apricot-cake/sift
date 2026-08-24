// 設定をどこに置くか。設定が何であるかは utils/settings.ts で、そちらは
// ビルドスクリプトが node で読めるように拡張機能の API を持たないままにしてある。
import { storage } from "wxt/utils/storage";
import { defaults, type Settings } from "./settings.ts";

// どの画面もこれを読み書きする。設定1つにつきキー1つではなく、1つのキーが
// 1つのオブジェクトを持つ形＝`defaults` は既に `Settings` を導く唯一の宣言で
// あり、設定ごとに `defineItem` を置くと既定値の写しがその隣にもう1組できる。
// 変更が「読み手が既に持っているものへ差分を戻す」ではなく「1つのイベントが値
// 全体を運ぶ」形になる利点もある。
export const settingsItem = storage.defineItem<Settings>("sync:settings", {
  fallback: defaults,
});
