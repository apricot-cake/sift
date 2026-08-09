// 7言語のキー網羅を検査する。#32 の受け入れ条件そのもの＝1言語からキーを1つ
// 落とす、または余計なキーを足すと、この describe が落ちる。
//
// @wxt-dev/i18n はビルド時に locales/*.yml を読んで _locales/*/messages.json
// を焼くだけで、7言語すべてが同じキー集合を持つかも、対象言語がこの7つで
// あることも検査しない＝それを言うのは Sift 側の方針で、ここでそれを言う。
// 対象言語を増やす判断は TARGET_LOCALES を書き換えることそのもの
// （README の「新しい言語の足し方」）。
import { readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  type ParsedMessage,
  parseMessagesFile,
  SUPPORTED_LOCALES,
} from "@wxt-dev/i18n/build";
import { describe, expect, it } from "vitest";

// Issue #32 が固定した対象＝hologram#222 の第1波7言語と同じ（ファイル名 →
// ブラウザのロケールコード）。ここにない名前のファイルが locales/ に増えたら、
// 対象言語を増やす判断を経ずに紛れ込んだということなので、それも検査する。
const TARGET_LOCALES: Readonly<Record<string, string>> = Object.freeze({
  en: "en",
  ja: "ja",
  ko: "ko",
  "zh-TW": "zh_TW",
  "zh-CN": "zh_CN",
  es: "es",
  "pt-BR": "pt_BR",
});

const DEFAULT_LOCALE = "en";

const localesDir = resolve(process.cwd(), "locales");
const localeFiles = readdirSync(localesDir).filter(
  (name) => extname(name) === ".yml",
);

it("locales/ が対象7言語のファイルだけを持っている", () => {
  const found = localeFiles.map((name) => name.replace(/\.yml$/, "")).sort();
  expect(found).toEqual(Object.keys(TARGET_LOCALES).sort());
});

it("どのファイル名もブラウザが受け付けるロケールコードに対応している", () => {
  for (const [file, code] of Object.entries(TARGET_LOCALES)) {
    expect({ file, supported: SUPPORTED_LOCALES.has(code) }).toEqual({
      file,
      supported: true,
    });
  }
});

// キーとその特徴（差し込み数・複数形かどうか）だけを取り出す。複数形の中身
// （1 と n のどちらの言い回しか）は言語ごとに違って当然なので比べない＝比べる
// のは「同じキーがある」ことと「同じ数の $N を持つ」ことだけ。
function summarize(
  messages: ParsedMessage[],
): Map<string, { substitutions: number; texts: string[] }> {
  const result = new Map<string, { substitutions: number; texts: string[] }>();
  for (const message of messages) {
    const key = message.key.join("_");
    const texts =
      message.type === "plural"
        ? Object.values(message.plurals)
        : [message.message];
    result.set(key, { substitutions: message.substitutions, texts });
  }
  return result;
}

const parsedByLocale = new Map<
  string,
  Map<string, { substitutions: number; texts: string[] }>
>();
for (const name of localeFiles) {
  const locale = name.replace(/\.yml$/, "");
  const parsed = await parseMessagesFile(resolve(localesDir, name));
  parsedByLocale.set(locale, summarize(parsed));
}

const defaultMessages = parsedByLocale.get(DEFAULT_LOCALE);
if (defaultMessages === undefined) {
  throw new Error(`既定ロケール ${DEFAULT_LOCALE} の locales/*.yml が無い`);
}
const defaultKeys = [...defaultMessages.keys()].sort();

describe.each([...parsedByLocale.keys()].filter((l) => l !== DEFAULT_LOCALE))(
  "%s",
  (locale) => {
    const messages = parsedByLocale.get(locale);
    if (messages === undefined) {
      throw new Error(`unreachable: ${locale} が見つからない`);
    }

    it(`${DEFAULT_LOCALE} と同じキーを名指ししている`, () => {
      expect([...messages.keys()].sort()).toEqual(defaultKeys);
    });

    it("どのメッセージも差し込みの数で一致している", () => {
      for (const key of defaultKeys) {
        const expected = defaultMessages.get(key);
        const actual = messages.get(key);
        expect({ key, substitutions: actual?.substitutions }).toEqual({
          key,
          substitutions: expected?.substitutions,
        });
      }
    });
  },
);

it("どのロケールも空のメッセージを残していない", () => {
  for (const [locale, messages] of parsedByLocale) {
    for (const [key, { texts }] of messages) {
      for (const [index, text] of texts.entries()) {
        expect({ locale, key, index, empty: text.trim() === "" }).toEqual({
          locale,
          key,
          index,
          empty: false,
        });
      }
    }
  }
});
