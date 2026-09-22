export const SIDE_PANEL_CONTROL = {
  configureForTab: "sift:sidepanel-configure-for-tab",
  setPanelTab: "sift:sidepanel-set-panel-tab",
} as const;

// パネルを開く通知は React の初期化より先に届くことがある。最後に開いたタブを
// session storage にも置き、パネル自身が起動後に読み取れるようにする。
export const SIDE_PANEL_TAB_STORAGE_KEY = "sift:sidepanel-tab-id";

export function isSidePanelTabId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export interface SidePanelConfigureRequest {
  readonly type: typeof SIDE_PANEL_CONTROL.configureForTab;
  readonly available: boolean;
}

export interface SidePanelTabRequest {
  readonly type: typeof SIDE_PANEL_CONTROL.setPanelTab;
  readonly tabId: number;
}

export function isSidePanelConfigureRequest(
  value: unknown,
): value is SidePanelConfigureRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === SIDE_PANEL_CONTROL.configureForTab &&
    typeof (value as { available?: unknown }).available === "boolean"
  );
}

export function isSidePanelTabRequest(
  value: unknown,
): value is SidePanelTabRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === SIDE_PANEL_CONTROL.setPanelTab &&
    isSidePanelTabId((value as { tabId?: unknown }).tabId)
  );
}
