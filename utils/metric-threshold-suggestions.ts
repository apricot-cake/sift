export interface MetricThresholdSuggestion {
  readonly count: number;
  readonly minimum: number;
}

const QUANTILES = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

function readableMinimum(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized < 2 ? 1 : normalized < 3 ? 2 : normalized < 5 ? 3 : 5;
  return step * magnitude;
}

export function metricThresholdSuggestions(
  values: readonly number[],
  currentMinimum: number,
): readonly MetricThresholdSuggestion[] {
  const sorted = values
    .filter((value) => Number.isSafeInteger(value) && value >= 0)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return [];

  const minimums = new Set<number>([currentMinimum]);
  for (const quantile of QUANTILES) {
    const index = Math.round((sorted.length - 1) * quantile);
    const value = sorted[index];
    if (value !== undefined) minimums.add(readableMinimum(value));
  }

  return Array.from(minimums)
    .filter((minimum) => Number.isSafeInteger(minimum) && minimum >= 0)
    .sort((left, right) => right - left)
    .map((minimum) => ({
      minimum,
      count: sorted.filter((value) => value >= minimum).length,
    }));
}
