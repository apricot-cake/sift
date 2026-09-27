export interface MetricThresholdSuggestion {
  readonly count: number;
  readonly minimum: number;
}

const STEPS = Object.freeze([1, 2, 3, 5]);

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
  const first = sorted[0];
  const highest = sorted.at(-1);
  if (first === undefined || highest === undefined) return [];

  const minimums = new Set<number>([currentMinimum]);
  const lowest = readableMinimum(first);
  if (lowest === 0) minimums.add(0);
  for (
    let magnitude = 10 ** Math.floor(Math.log10(Math.max(1, lowest)));
    magnitude <= highest;
    magnitude *= 10
  ) {
    for (const step of STEPS) {
      const minimum = step * magnitude;
      if (minimum >= lowest && minimum <= highest) minimums.add(minimum);
    }
  }

  return Array.from(minimums)
    .filter((minimum) => Number.isSafeInteger(minimum) && minimum >= 0)
    .sort((left, right) => right - left)
    .map((minimum) => ({
      minimum,
      count: sorted.filter((value) => value >= minimum).length,
    }));
}
