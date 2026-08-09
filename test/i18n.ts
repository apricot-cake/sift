// テストを走らせるたびに、本物の英語メッセージファイルに対して
// browser.i18n.getMessage を動かすためのもの。WXT の偽ブラウザは i18n を
// 実装しないまま置いていて＝呼ぶと例外になる、「キーをそのまま返す」で
// 埋めてしまうと、どこにも存在しないメッセージ名が、それを描くテスト全部を
// 素通りしてしまう。
//
// 英語なのは、それが既定のロケールだから＝日本語を持たないブラウザのために
// 落ちる先がそこであり、揃っていなければならない方のファイルを読むことが、
// 欠けたキーを読み手の前ではなくここで落とすことになる。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

// import ではなく node で読む＝Vitest はモジュールを http で配るので
// `import.meta.url` はここではファイルの経路にならないし、JSON の import は
// バンドルの中にファイルの写しをもう1つ作ることになる。
export function readMessages(locale: string): Record<string, MessageEntry> {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `public/_locales/${locale}/messages.json`),
      "utf8",
    ),
  );
}

const messages = readMessages("en");

// Chrome が $NAME$ に対してすること＝その名前を `placeholders` から引き、
// その `content` が指す位置の引数を読んで（$1 が最初）、そこへ入れる。
// placeholder の名前は大文字小文字を区別せずに照合される。
export function getMessage(
  key: string,
  substitutions?: string | string[],
): string {
  const entry = messages[key];
  if (entry === undefined) {
    throw new Error(
      `public/_locales/en に ${key} という名前のメッセージが無い`,
    );
  }

  const args =
    substitutions === undefined
      ? []
      : typeof substitutions === "string"
        ? [substitutions]
        : substitutions;

  let text = entry.message;
  for (const [name, { content }] of Object.entries(entry.placeholders ?? {})) {
    const position = Number(content.slice(1)) - 1;
    text = text.replaceAll(`$${name.toUpperCase()}$`, args[position] ?? "");
  }
  return text;
}

// fakeBrowser.reset() はテストとテストの間に走り、未実装の関数を戻してしまう
// ので、これは一度きりの代入ではなく毎回入れ直す。
beforeEach(() => {
  fakeBrowser.i18n.getMessage =
    getMessage as typeof fakeBrowser.i18n.getMessage;
});
