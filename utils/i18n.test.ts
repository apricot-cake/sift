import { describe, expect, it } from "vitest";
import { render } from "../test/dom.ts";
import { readLocaleMessages } from "../test/i18n.ts";
import { localizeDocument } from "./i18n.ts";

const english = await readLocaleMessages("en");

describe("localizeDocument()", () => {
  it("文字・placeholder・aria-label を埋める", () => {
    const root = render(`
      <p data-i18n="optionsMinLikes"></p>
      <input
        data-i18n-placeholder="optionsPublicationPeriodValue"
        data-i18n-aria-label="optionsPublicationPeriodUnit"
      >
    `);

    localizeDocument(root);

    const paragraph = root.querySelector("p");
    const input = root.querySelector("input");
    expect(paragraph?.textContent).toBe(english.optionsMinLikes?.message);
    expect(input?.getAttribute("placeholder")).toBe(
      english.optionsPublicationPeriodValue?.message,
    );
    expect(input?.getAttribute("aria-label")).toBe(
      english.optionsPublicationPeriodUnit?.message,
    );
  });

  // 属性の形は属性だけを書き、他には何もしない＝<input> は自分の文字を持たない
  // し、両方を受けるボタンは自分のラベルを失う。
  it("属性だけを求められた所では文字に触れない", () => {
    const root = render(
      '<input data-i18n-placeholder="optionsPublicationPeriodValue" value="kept">',
    );

    localizeDocument(root);

    expect(root.querySelector("input")?.value).toBe("kept");
  });
});
