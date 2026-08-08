// Every string a reader sees comes through here. The strings themselves live in
// public/_locales/<language>/messages.json, which the browser picks from on its
// own — there is no language switch in the extension, because browser.i18n has
// no way to offer one (WXT's own i18n guide says the same, and recommends the
// bare API over a bundled library for exactly the reasons that matter here: the
// manifest can be localized too, lookups are synchronous, and no copy of the
// translations is bundled into each entrypoint).
//
// `en` is the default locale, so a browser set to anything Sift has no messages
// for reads English.
import { browser } from "wxt/browser";

// The keys, taken from the English file — the one that is complete by
// definition, since it is the fallback. Imported as a type alone, so nothing of
// the JSON reaches a bundle. A typo in a key is a compile error, and a key
// removed from the messages file breaks every call site that still wants it.
type Messages = typeof import("../public/_locales/en/messages.json");
export type MessageKey = keyof Messages;

// Substitutions are positional ($1, $2, ...), named in the messages file under
// `placeholders`. Only toolbarStatusCounts uses them.
export function t(key: MessageKey, ...substitutions: string[]): string {
  return browser.i18n.getMessage(key, substitutions);
}

// Which attribute each suffixed form writes. `data-i18n` on its own replaces the
// element's text; these write an attribute and leave the text alone. Exported so
// a test can hold the markup to the same list this reads.
export const I18N_ATTRIBUTES = Object.freeze({
  "data-i18n-placeholder": "placeholder",
  "data-i18n-aria-label": "aria-label",
});

// Fills in the message names a document declares. Static HTML cannot carry
// __MSG_name__ the way the manifest can — that substitution is the manifest
// parser's, not the HTML parser's — so a document written once has to be
// localized at load instead. Every entrypoint with static markup calls this
// before it shows anything.
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
