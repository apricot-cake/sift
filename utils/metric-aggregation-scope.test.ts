import { describe, expect, it } from "vitest";
import { metricAggregationScope } from "./metric-aggregation-scope.ts";

describe("再生回数候補の集計範囲", () => {
  const nowMs = Date.UTC(2026, 8, 23);

  it("最古の動画の経過期間を表す", () => {
    expect(
      metricAggregationScope(
        [nowMs - 2 * 24 * 60 * 60 * 1000, nowMs - 400 * 24 * 60 * 60 * 1000],
        nowMs,
      ),
    ).toEqual({
      oldest: { value: 1, unit: "year" },
    });
  });

  it("日付を取得できない動画だけなら範囲を出さない", () => {
    expect(metricAggregationScope([], nowMs)).toBeNull();
  });

  it("大量の日付も引数展開せずに集計する", () => {
    const dates = Array.from({ length: 130_000 }, (_, index) => nowMs - index);
    expect(metricAggregationScope(dates, nowMs)).toEqual({
      oldest: { value: 0, unit: "day" },
    });
  });
});
