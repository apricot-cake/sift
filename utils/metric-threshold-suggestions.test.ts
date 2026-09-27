import { describe, expect, it } from "vitest";
import { metricThresholdSuggestions } from "./metric-threshold-suggestions.ts";

describe("再生回数の候補", () => {
  it("候補ごとにその値以上の累積件数を出す", () => {
    expect(
      metricThresholdSuggestions([300, 900, 3_100, 11_000], 3_000),
    ).toEqual([
      { minimum: 10_000, count: 1 },
      { minimum: 3_000, count: 2 },
      { minimum: 500, count: 3 },
      { minimum: 300, count: 4 },
    ]);
  });

  it("突出した動画を上側の候補に残しても、他の候補を大半の動画から作る", () => {
    const values = [120, 180, 240, 310, 420, 560, 1_000_000];

    expect(metricThresholdSuggestions(values, 300)).toEqual([
      { minimum: 1_000_000, count: 1 },
      { minimum: 500, count: 2 },
      { minimum: 300, count: 4 },
      { minimum: 200, count: 5 },
      { minimum: 100, count: 7 },
    ]);
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
