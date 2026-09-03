export function shouldEnableFiltering({
  contentFilteringEnabled,
  hasNextPage,
  hasPreviousPage,
  pageChanged,
  panelExpectedFiltering,
  panelInitialized,
}: {
  contentFilteringEnabled: boolean;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  pageChanged: boolean;
  panelExpectedFiltering: boolean;
  panelInitialized: boolean;
}): boolean {
  if (!hasNextPage) {
    return false;
  }

  return (
    !panelInitialized ||
    !hasPreviousPage ||
    pageChanged ||
    (panelExpectedFiltering && !contentFilteringEnabled)
  );
}

export function shouldDisablePreviousFiltering({
  pageChanged,
  previousTabId,
  nextTabId,
}: {
  pageChanged: boolean;
  previousTabId: number | null;
  nextTabId: number | null;
}): boolean {
  return (
    pageChanged &&
    previousTabId !== null &&
    (nextTabId === null || previousTabId !== nextTabId)
  );
}
