export const SIDE_PANEL_CONTROL = {
  configureForTab: "sift:sidepanel-configure-for-tab",
  setPanelTab: "sift:sidepanel-set-panel-tab",
} as const;

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
    Number.isInteger((value as { tabId?: unknown }).tabId)
  );
}
