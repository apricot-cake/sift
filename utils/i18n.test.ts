import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "../test/dom.ts";
import { readLocaleMessages } from "../test/i18n.ts";
import { I18N_ATTRIBUTES, localizeDocument, t } from "./i18n.ts";

const english = await readLocaleMessages("en");

// import ではなく node で読む＝Vitest の下では `import.meta.url` が http の URL
// になるし、HTML のエントリポイントを Vite の `?raw` で読むと、書いたままの
// ファイルではなく HTML の処理を通った後のものが返る。
function readFromRoot(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

// happy-dom は解析しながら <link> と <script> を、どのテストも立てていない
// サーバーへ http で取りに行く＝しかもその失敗を非同期に、原因のテストが通り
// 終わった後で報告する。この2つのタグを落としても、ここが読むものは何も
// 変わらない。
function parseEntrypoint(path: string): Document {
  const html = readFromRoot(path)
    .replace(/<link\b[^>]*>/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  return new DOMParser().parseFromString(html, "text/html");
}

// 静的なマークアップを持つ画面2つ。ツールバーのものはコードで組み立てられて
// いて、名前はコンパイラが既に見ている。
const STATIC_PAGES = [
  "entrypoints/options/index.html",
  "entrypoints/popup/index.html",
];

// マークアップの中の名前は、コンパイラから見ればただの文字＝属性の値を型で
// 見るものは何も無いので、名前の変更を捕まえるのはこれ。index.html は英語の
// 文そのものも持っている＝main.ts が走る前の一瞬のためと、走らせずに
// マークアップだけを読むもののため。両者を突き合わせておくことが、その写しが
// 2つ目の・古い言い回しへずれていくのを止めている。
//
// ここで名指すのはどれも差し込みも複数形も持たないメッセージ＝data-i18n 系の
// 属性は素の文字列を1つ埋めるだけで、その形は locales/locales.test.ts が
// 別に検査する。
describe.each(STATIC_PAGES)("%s", (path) => {
  const page = parseEntrypoint(path);

  it("存在するメッセージだけを名指しし、その中身を書いている", () => {
    const elements = page.querySelectorAll("[data-i18n]");
    expect(elements.length).toBeGreaterThan(0);

    for (const element of elements) {
      const name = element.getAttribute("data-i18n");
      expect({ name, text: element.textContent }).toEqual({
        name,
        text: english[name ?? ""]?.message,
      });
    }
  });

  it("使っている属性についても同じ", () => {
    for (const [attribute, target] of Object.entries(I18N_ATTRIBUTES)) {
      for (const element of page.querySelectorAll(`[${attribute}]`)) {
        const name = element.getAttribute(attribute);
        expect({ name, value: element.getAttribute(target) }).toEqual({
          name,
          value: english[name ?? ""]?.message,
        });
      }
    }
  });
});

// 2つのページで属性の形を全部使い切っていないと、壊れたものが、それを使わなく
// なった方のページで気付かれないまま残りうる。
it("翻訳される属性はどれか一方のページに出ている", () => {
  const pages = STATIC_PAGES.map(parseEntrypoint);
  for (const attribute of Object.keys(I18N_ATTRIBUTES)) {
    const found = pages.some(
      (page) => page.querySelectorAll(`[${attribute}]`).length > 0,
    );
    expect({ attribute, found }).toEqual({ attribute, found: true });
  }
});

describe("t()", () => {
  it("メッセージを返す", () => {
    expect(t("optionsInstanceAdd")).toBe(english.optionsInstanceAdd?.message);
  });
});

describe("localizeDocument()", () => {
  it("文字・placeholder・aria-label を埋める", () => {
    const root = render(`
      <p data-i18n="optionsTagline"></p>
      <input
        data-i18n-placeholder="optionsInstancePlaceholder"
        data-i18n-aria-label="optionsInstanceInputLabel"
      >
    `);

    localizeDocument(root);

    const paragraph = root.querySelector("p");
    const input = root.querySelector("input");
    expect(paragraph?.textContent).toBe(english.optionsTagline?.message);
    expect(input?.getAttribute("placeholder")).toBe(
      english.optionsInstancePlaceholder?.message,
    );
    expect(input?.getAttribute("aria-label")).toBe(
      english.optionsInstanceInputLabel?.message,
    );
  });

  // 属性の形は属性だけを書き、他には何もしない＝<input> は自分の文字を持たない
  // し、両方を受けるボタンは自分のラベルを失う。
  it("属性だけを求められた所では文字に触れない", () => {
    const root = render(
      '<input data-i18n-placeholder="optionsInstancePlaceholder" value="kept">',
    );

    localizeDocument(root);

    expect(root.querySelector("input")?.value).toBe("kept");
  });
});
