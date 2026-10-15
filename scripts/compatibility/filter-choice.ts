/** 両側に実投稿を残し、一覧の大半を隠して追加取得を誘発する値を避ける。 */
export function selectPartialChoice<T extends { index: number; count: number }>(
  choices: readonly T[],
  total: number,
): T | undefined {
  if (!Number.isFinite(total) || total <= 1) return undefined;
  return choices
    .filter(
      (choice) =>
        choice.index > 0 &&
        Number.isFinite(choice.count) &&
        choice.count > 0 &&
        choice.count < total,
    )
    .sort(
      (a, b) =>
        Math.abs(a.count - total / 2) - Math.abs(b.count - total / 2) ||
        b.count - a.count,
    )[0];
}
