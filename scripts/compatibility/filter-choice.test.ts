import { expect, it } from "vitest";
import { selectPartialChoice } from "./filter-choice.ts";

it("検索の大半を消す条件より、残る投稿と消える投稿を十分に含む条件を選ぶ", () => {
  const options = [
    { index: 0, count: 75 },
    { index: 1, count: 0 },
    { index: 2, count: 1 },
    { index: 3, count: 3 },
    { index: 4, count: 6 },
    { index: 5, count: 10 },
    { index: 6, count: 23 },
    { index: 7, count: 75 },
  ];
  expect(selectPartialChoice(options, 75)?.index).toBe(6);
});
it("同じ除外効果なら残る投稿が多い値を選ぶ", () => {
  expect(
    selectPartialChoice(
      [
        { index: 1, count: 2 },
        { index: 2, count: 6 },
      ],
      8,
    )?.index,
  ).toBe(2);
});
it("全件残る値と全件消える値を部分除外の成功として選ばない", () => {
  expect(
    selectPartialChoice(
      [
        { index: 0, count: 5 },
        { index: 1, count: 0 },
        { index: 2, count: 5 },
        { index: 3, count: Number.NaN },
      ],
      5,
    ),
  ).toBeUndefined();
});
