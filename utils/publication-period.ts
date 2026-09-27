export const PUBLICATION_PERIODS = [
  { days: 7, value: 1, unit: "week" },
  { days: 30, value: 1, unit: "month" },
  { days: 90, value: 3, unit: "month" },
  { days: 180, value: 6, unit: "month" },
  { days: 365, value: 1, unit: "year" },
  { days: 730, value: 2, unit: "year" },
  { days: 1095, value: 3, unit: "year" },
  { days: 1825, value: 5, unit: "year" },
  { days: 3650, value: 10, unit: "year" },
  { days: 7300, value: 20, unit: "year" },
] as const;

export function countWithinPeriod(
  dates: readonly number[],
  days: number,
  now = Date.now(),
): number {
  return dates.filter(
    (date) => Number.isFinite(date) && now - date <= days * 86400000,
  ).length;
}
