import { describe, expect, it } from "vitest";
import { metricThresholdSuggestions } from "./metric-threshold-suggestions.ts";

describe("再生回数の候補", () => {
  it("空配列やゼロと不正値も安全に扱う", () => {
    expect(metricThresholdSuggestions([], 100)).toEqual([]);
    expect(metricThresholdSuggestions([0, -1, NaN, Infinity], 0)).toEqual([
      { minimum: 0, count: 1 },
    ]);
  });
  it("候補ごとにその値以上の累積件数を出す", () => {
    expect(
      metricThresholdSuggestions([300, 900, 3_100, 11_000], 3_000),
    ).toEqual([
      { minimum: 10_000, count: 1 },
      { minimum: 5_000, count: 1 },
      { minimum: 3_000, count: 2 },
      { minimum: 2_000, count: 2 },
      { minimum: 1_000, count: 2 },
      { minimum: 500, count: 3 },
      { minimum: 300, count: 4 },
    ]);
  });

  it("突出した動画があっても途中の段階を省略しない", () => {
    const values = [120, 180, 240, 310, 420, 560, 1_000_000];

    const result = metricThresholdSuggestions(values, 300);
    expect(result).toHaveLength(17);
    expect(result).toContainEqual({ minimum: 500_000, count: 1 });
    expect(result).toContainEqual({ minimum: 1_000, count: 1 });
    expect(result.at(-1)).toEqual({ minimum: 100, count: 7 });
  });

  it("候補の下限を読み込まれた最大値より上に丸めない", () => {
    expect(metricThresholdSuggestions([87_000], 10_000)).toEqual([
      { minimum: 50_000, count: 1 },
      { minimum: 10_000, count: 1 },
    ]);
  });

  it("現在の設定値は分布の候補に無くても残す", () => {
    expect(
      metricThresholdSuggestions([1_000, 2_000, 3_000], 2_500),
    ).toContainEqual({
      minimum: 2_500,
      count: 1,
    });
  });
});
