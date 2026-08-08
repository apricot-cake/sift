// WXT generates .wxt/types/i18n.d.ts, but only for the `@@`-prefixed messages
// every extension has — it does not read public/_locales. That is what the
// @wxt-dev/i18n module would do, and this project uses the bare browser.i18n
// API instead (see utils/i18n.ts for why). Merging this project's own message
// names into the same interface is what makes a typo in one a compile error.
import "wxt/browser";

declare module "wxt/browser" {
  export interface WxtI18n {
    getMessage(
      messageName: keyof typeof import("./public/_locales/en/messages.json"),
      substitutions?: string | string[],
    ): string;
  }
}
