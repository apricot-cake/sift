export type MetricAggregationAgeUnit = "day" | "month" | "year";

export interface MetricAggregationAge {
  readonly value: number;
  readonly unit: MetricAggregationAgeUnit;
}

export interface MetricAggregationScope {
  readonly oldest: MetricAggregationAge;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

function ageFrom(nowMs: number, createdAtMs: number): MetricAggregationAge {
  const ageDays = Math.max(0, Math.floor((nowMs - createdAtMs) / DAY_MS));
  if (ageDays < MONTH_DAYS) {
    return { value: ageDays, unit: "day" };
  }
  if (ageDays < YEAR_DAYS) {
    return { value: Math.floor(ageDays / MONTH_DAYS), unit: "month" };
  }
  return { value: Math.floor(ageDays / YEAR_DAYS), unit: "year" };
}

/**
 * 読み込み済み動画の範囲を示すための公開時期。公開日時を読めない動画だけの
 * 場合は null にし、パネルでは期間を表示しない。
 */
export function metricAggregationScope(
  createdAtMs: readonly number[],
  nowMs: number,
): MetricAggregationScope | null {
  const dates = createdAtMs.filter((value) => Number.isSafeInteger(value));
  if (dates.length === 0) {
    return null;
  }
  const oldest = Math.min(...dates);
  return {
    oldest: ageFrom(nowMs, oldest),
  };
}
