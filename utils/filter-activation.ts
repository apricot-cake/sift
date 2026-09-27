export function shouldEnableFiltering({
  contentFilteringEnabled,
  hasNextPage,
  panelTabMatches,
  panelExpectedFiltering,
  panelInitialized,
}: {
  contentFilteringEnabled: boolean;
  hasNextPage: boolean;
  panelTabMatches: boolean;
  panelExpectedFiltering: boolean;
  panelInitialized: boolean;
}): boolean {
  if (!hasNextPage || !panelTabMatches) {
    return false;
  }

  return (
    !panelInitialized || (panelExpectedFiltering && !contentFilteringEnabled)
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
