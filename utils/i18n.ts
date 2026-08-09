// 読み手が目にする文字は全部ここを通る。文字そのものは
// public/_locales/<言語>/messages.json にあり、そこからどれを使うかはブラウザが
// 自分で決める＝拡張機能の中に言語の切り替えは無い。browser.i18n がそれを
// 差し出す手段を持たないから（WXT 自身の i18n ガイドも同じことを言っていて、
// ここで効く理由そのものを挙げて、束ねたライブラリより素の API を勧めている＝
// manifest も翻訳できる・引きが同期・翻訳の写しがエントリポイントごとに
// バンドルへ入らない）。
//
// 既定のロケールは `en` なので、Sift がメッセージを持たない言語に設定された
// ブラウザは英語を読む。
import { browser } from "wxt/browser";

// キーは英語のファイルから取る＝それが翻訳の落ちる先である以上、定義上そこは
// 常に揃っている。型としてだけ読み込むので、JSON の中身はバンドルへ届かない。
// キーの打ち間違いはコンパイルエラーになり、メッセージファイルから消えたキーは
// それをまだ欲しがっている呼び出し側を全部壊す。
type Messages = typeof import("../public/_locales/en/messages.json");
export type MessageKey = keyof Messages;

// 差し込みは位置指定（$1・$2 ...）で、名前はメッセージファイルの
// `placeholders` に書く。使っているのは toolbarStatusCounts だけ。
export function t(key: MessageKey, ...substitutions: string[]): string {
  return browser.i18n.getMessage(key, substitutions);
}

// 接尾辞の付いた形が、それぞれどの属性へ書き込むか。`data-i18n` 単体は要素の
// 文字を置き換えるが、こちらは属性へ書いて文字には触れない。エクスポートして
// あるのは、マークアップがこれと同じ一覧に従っているかをテストが確かめるため。
export const I18N_ATTRIBUTES = Object.freeze({
  "data-i18n-placeholder": "placeholder",
  "data-i18n-aria-label": "aria-label",
});

// 文書が宣言したメッセージ名を埋める。静的な HTML は manifest のように
// __MSG_name__ を書けない＝あの置換をするのは manifest の読み手であって HTML の
// 読み手ではない。だから一度書かれた文書は、読み込み時に翻訳するしかない。
// 静的なマークアップを持つエントリポイントは、何かを見せる前に必ずこれを呼ぶ。
export function localizeDocument(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key !== undefined) {
      element.textContent = t(key as MessageKey);
    }
  }

  for (const [attribute, target] of Object.entries(I18N_ATTRIBUTES)) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      const key = element.getAttribute(attribute);
      if (key !== null) {
        element.setAttribute(target, t(key as MessageKey));
      }
    }
  }
}
