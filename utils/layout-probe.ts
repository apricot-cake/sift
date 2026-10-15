import type { ClassifyState } from "./filter-core.ts";

export function hasRetainedPostBelowViewport(
  updates: readonly {
    cell: Pick<HTMLElement, "getBoundingClientRect">;
    state: ClassifyState | null;
  }[],
  viewportHeight: number,
): boolean {
  return updates.some(
    ({ cell, state }) =>
      (state === "matched" || state === "visible") &&
      cell.getBoundingClientRect().bottom > viewportHeight + 4,
  );
}
