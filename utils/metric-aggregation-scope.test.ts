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
});
