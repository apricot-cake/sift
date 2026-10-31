export const PANEL_LOAD_MORE = "sift:panel-load-more";
export const PANEL_CANCEL_LOAD = "sift:panel-cancel-load";

export interface LoadMoreRequest {
  readonly type: typeof PANEL_LOAD_MORE;
  readonly pageKey: string;
  readonly timelineKey: string | null;
}

export type LoadMoreStatus =
  | "loaded"
  | "no-progress"
  | "limited"
  | "authentication"
  | "cancelled"
  | "unsupported"
  | "limit"
  | "failed";

export interface LoadMoreResponse {
  readonly status: LoadMoreStatus;
  readonly added: number;
}

export function isLoadMoreRequest(value: unknown): value is LoadMoreRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<LoadMoreRequest>;
  return (
    request.type === PANEL_LOAD_MORE &&
    typeof request.pageKey === "string" &&
    request.pageKey.length <= 4096 &&
    (request.timelineKey === null ||
      (typeof request.timelineKey === "string" &&
        request.timelineKey.length <= 4096))
  );
}

export function isLoadMoreResponse(value: unknown): value is LoadMoreResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<LoadMoreResponse>;
  return (
    [
      "loaded",
      "no-progress",
      "limited",
      "authentication",
      "cancelled",
      "unsupported",
      "limit",
      "failed",
    ].includes(response.status ?? "") &&
    Number.isSafeInteger(response.added) &&
    (response.added ?? -1) >= 0 &&
    (response.added ?? Infinity) <= 1000
  );
}
