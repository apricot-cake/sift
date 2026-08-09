// テストを走らせるたびに、本物の英語メッセージに対して browser.i18n.getMessage
// を動かすためのもの。WXT の偽ブラウザは i18n を実装しないまま置いていて＝
// 呼ぶと例外になる、「キーをそのまま返す」で埋めてしまうと、どこにも存在しない
// メッセージ名が、それを描くテスト全部を素通りしてしまう。
//
// メッセージは locales/<言語>.yml から作る＝@wxt-dev/i18n がビルド時に
// _locales/<言語>/messages.json へ焼くのと同じ変換（parseMessagesFile →
// generateChromeMessages）をそのまま呼ぶので、複数形（0/1/n）が " | " で
// 結合される形も含めて、実際に焼かれるものと1つも違わない。
//
// 既定ロケールが英語なのは、それが Sift がメッセージを持たない言語のブラウザに
// 落ちる先だから＝揃っていなければならない方のファイルを読むことが、欠けた
// キーを読み手の前ではなくここで落とすことになる。
import { resolve } from "node:path";
import {
  type ChromeMessage,
  generateChromeMessages,
  parseMessagesFile,
} from "@wxt-dev/i18n/build";
import { beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

export async function readLocaleMessages(
  locale: string,
): Promise<Record<string, ChromeMessage>> {
  return generateChromeMessages(
    await parseMessagesFile(resolve(process.cwd(), `locales/${locale}.yml`)),
  );
}

// Vitest のトップレベル await で1回だけ読む＝setupFiles はテストファイルより
// 先に、かつ一度だけ評価される。
const englishMessages = await readLocaleMessages("en");

// Chrome が $1 〜 $9 に対してすること＝該当する差し込み引数（$1 が最初）を
// そのまま文字列へ差し込む。`$$` は逃した `$` 1文字になる。名前付き
// プレースホルダ（$NAME$）は使っていないので対応しない。
function substitute(message: string, args: readonly string[]): string {
  return message.replace(/\$(\$|[1-9])/g, (_match, token: string) =>
    token === "$" ? "$" : (args[Number(token) - 1] ?? ""),
  );
}

export function getMessage(
  key: string,
  substitutions?: string | string[],
): string {
  const entry = englishMessages[key];
  if (entry === undefined) {
    throw new Error(`locales/en.yml に ${key} という名前のメッセージが無い`);
  }

  const args =
    substitutions === undefined
      ? []
      : typeof substitutions === "string"
        ? [substitutions]
        : substitutions;

  return substitute(entry.message, args);
}

// fakeBrowser.reset() はテストとテストの間に走り、未実装の関数を戻してしまう
// ので、これは一度きりの代入ではなく毎回入れ直す。
beforeEach(() => {
  fakeBrowser.i18n.getMessage =
    getMessage as typeof fakeBrowser.i18n.getMessage;
});
