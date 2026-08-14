export const OPEN_OPTIONS_PAGE = "sift:open-options-page";

export interface OpenOptionsPageRequest {
  readonly type: typeof OPEN_OPTIONS_PAGE;
}

export function isOpenOptionsPageRequest(
  value: unknown,
): value is OpenOptionsPageRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === OPEN_OPTIONS_PAGE
  );
}
