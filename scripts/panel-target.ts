/** タブ専用パネルを、拡張機能と所有タブの両方で識別する。 */
export function isOwnedPanelUrl(
  value: string,
  extensionId: string,
  tabId: number,
): boolean {
  if (!Number.isSafeInteger(tabId) || tabId <= 0) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "chrome-extension:" &&
      url.host === extensionId &&
      url.pathname === "/sidepanel.html" &&
      url.searchParams.getAll("tabId").length === 1 &&
      url.searchParams.get("tabId") === String(tabId)
    );
  } catch {
    return false;
  }
}

/** イベント path の query に依存せず、通知の tabId で所有を判定する。 */
export function isOwnedPanelEvent(
  event: { path: string; tabId?: number },
  extensionId: string,
  tabId: number,
): boolean {
  if (!Number.isSafeInteger(tabId) || tabId <= 0 || event.tabId !== tabId)
    return false;
  try {
    const url = new URL(event.path, `chrome-extension://${extensionId}/`);
    return (
      url.protocol === "chrome-extension:" &&
      url.host === extensionId &&
      url.pathname === "/sidepanel.html"
    );
  } catch {
    return false;
  }
}
