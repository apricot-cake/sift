export const OPEN_LIVE_CONTROLS = "sift:open-live-controls";

export interface OpenLiveControlsRequest {
  readonly type: typeof OPEN_LIVE_CONTROLS;
}

export function isOpenLiveControlsRequest(
  value: unknown,
): value is OpenLiveControlsRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === OPEN_LIVE_CONTROLS
  );
}
