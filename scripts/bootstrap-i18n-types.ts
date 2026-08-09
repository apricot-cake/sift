// `postinstall` で `wxt prepare` の直前に走る。
//
// entrypoint（content script・background）は defineContentScript() /
// defineBackground() の設定を得るため、`wxt prepare` 自身の最初の一手として
// Vite の SSR で実際に実行される
// （node_modules/wxt/dist/core/utils/building/find-entrypoints.mjs の
// importEntrypoints() → wxt/dist/core/builders/vite/index.mjs の
// importEntrypoints()）。entrypoints/content/index.ts は utils/i18n.ts を経て
// `#i18n` を静的 import しているが、`#i18n`（.wxt/i18n/index.ts）を書き出すのは
// @wxt-dev/i18n の prepare:types フックで、それが走るのは
// generateWxtDir()＝findEntrypoints() の後（wxt/dist/core/prepare.mjs）。
//
// 結果、`.wxt/` が空の状態（`npm ci` 直後・CI・新規clone）では `wxt prepare`
// 自身が「Cannot find module '#i18n'」で毎回落ちる（2026-08-09 に確認・
// wxt 0.21.3 + @wxt-dev/i18n 0.2.7・vite 8.2.0 の組み合わせ。手元で1度でも
// 通した後の `.wxt/` が残っていると再現しない＝気付きにくい）。entrypoint の
// 実行より前に、@wxt-dev/i18n 自身が書くのと同じ中身（@wxt-dev/i18n/build の
// 同じ関数から作る＝別実装ではない）を先に一度だけ置いておけば、その時点で
// `#i18n` が解決できる。中身は後続の `wxt prepare` 自身が同じものへ上書きする
// ＝これは正本の先取りであって、二重管理ではない。
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateTypeText, parseMessagesFile } from "@wxt-dev/i18n/build";

// wxt.config.ts の manifest.default_locale と同じ値。あちらを正本のまま保つため
// ここでは読み込まない＝wxt.config.ts は wxt 自身の型やプラグインを読み込む
// 副作用の大きいファイルで、このスクリプトが要るのは `wxt prepare` より前の
// 最小限の下ごしらえだけ。ここが指すロケールファイルが無ければ次の
// `parseMessagesFile` がそのまま例外を投げるので、値がずれれば必ず気付く。
const DEFAULT_LOCALE = "en";

const root = resolve(import.meta.dirname, "..");
const i18nDir = resolve(root, ".wxt", "i18n");
await mkdir(i18nDir, { recursive: true });

// @wxt-dev/i18n の src/module.ts が書くのと文字どおり同じテンプレート。
await writeFile(
  resolve(i18nDir, "index.ts"),
  `import { createI18n } from '@wxt-dev/i18n';
import type { GeneratedI18nStructure } from './structure';

export const i18n = createI18n<GeneratedI18nStructure>();

export { type GeneratedI18nStructure }
`,
);

const messages = await parseMessagesFile(
  resolve(root, "locales", `${DEFAULT_LOCALE}.yml`),
);
await writeFile(resolve(i18nDir, "structure.d.ts"), generateTypeText(messages));

console.log("[sift] wxt prepare の前に .wxt/i18n を下ごしらえした");
