// 読み手が目にする文字は全部ここを通る。文字そのものは locales/<言語>.yml に
// あり、そこからどれを使うかはブラウザが自分で決める＝拡張機能の中に言語の
// 切り替えは無い。browser.i18n がそれを差し出す手段を持たないから（WXT 自身の
// i18n ガイドも同じことを言っていて、ここで効く理由そのものを挙げて、束ねた
// ライブラリより素の API を勧めている＝manifest も翻訳できる・引きが同期・
// 翻訳の写しがエントリポイントごとにバンドルへ入らない）。
//
// @wxt-dev/i18n（wxt.config.ts の modules）がビルド時に locales/*.yml を
// _locales/*/messages.json へ焼き、それを読む薄いラッパーが `#i18n` の
// `i18n.t()`＝素の browser.i18n.getMessage に、複数形分岐（0/1/n）と型を足した
// もの。
//
// 既定のロケールは `en` なので、Sift がメッセージを持たない言語に設定された
// ブラウザは英語を読む。
import { type GeneratedI18nStructure, i18n } from "#i18n";

// t() が受け取れるキーをそのまま外へ出す＝呼び出し側は複数形や差し込みも含めて
// i18n.t() の型付けをそのまま受け取る。単なる再代入なので、オーバーロードは
// 1つも失われない。
export const t = i18n.t;

// 差し込みも複数形も持たないメッセージだけの部分集合。data-i18n 系の属性は
// マークアップの中の文字列でしかなく、コンパイラはそれをキーの型として読まない
// ＝ localizeDocument() の中でだけ使うキャスト先。
type SimpleMessageKey = keyof {
  [K in keyof GeneratedI18nStructure as GeneratedI18nStructure[K] extends {
    plural: false;
    substitutions: 0;
  }
    ? K
    : never]: true;
};

// utils/adapters/types.ts が名指す型。アダプターのしきい値ラベルはどれも
// 差し込みも複数形も持たないので、実体は SimpleMessageKey と同じ集合。
export type MessageKey = SimpleMessageKey;

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
      element.textContent = t(key as SimpleMessageKey);
    }
  }

  for (const [attribute, target] of Object.entries(I18N_ATTRIBUTES)) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      const key = element.getAttribute(attribute);
      if (key !== null) {
        element.setAttribute(target, t(key as SimpleMessageKey));
      }
    }
  }
}
