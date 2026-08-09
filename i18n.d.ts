// WXT は .wxt/types/i18n.d.ts を生成するが、それはどの拡張機能も持つ `@@` 付きの
// メッセージについてだけで、public/_locales は読まない。それをするのは
// @wxt-dev/i18n のモジュールの方で、このプロジェクトは代わりに素の browser.i18n
// の API を使っている（理由は utils/i18n.ts）。このプロジェクト自身のメッセージ名を
// 同じインターフェースへ混ぜ込むことが、その打ち間違いをコンパイルエラーにしている。
import "wxt/browser";

declare module "wxt/browser" {
  export interface WxtI18n {
    getMessage(
      messageName: keyof typeof import("./public/_locales/en/messages.json"),
      substitutions?: string | string[],
    ): string;
  }
}
