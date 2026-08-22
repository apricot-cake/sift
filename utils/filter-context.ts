import type { SettingsScopeKind, SiteSettingsKey } from "./settings.ts";

export const FILTER_CONTEXT_REQUEST = "sift:get-filter-context";

export interface FilterContextRequest {
  readonly type: typeof FILTER_CONTEXT_REQUEST;
}

export interface FilterContextResponse {
  readonly site: SiteSettingsKey;
  readonly scopeKey: string | null;
  readonly scopeKind: SettingsScopeKind | null;
  readonly pageTitle: string;
}

export function isFilterContextRequest(
  value: unknown,
): value is FilterContextRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === FILTER_CONTEXT_REQUEST
  );
}

export function isFilterContextResponse(
  value: unknown,
): value is FilterContextResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const response = value as Partial<FilterContextResponse>;
  return (
    (response.site === "x" ||
      response.site === "bluesky" ||
      response.site === "misskey" ||
      response.site === "youtube") &&
    (response.scopeKey === null || typeof response.scopeKey === "string") &&
    (response.scopeKind === null ||
      response.scopeKind === "following" ||
      response.scopeKind === "home" ||
      response.scopeKind === "list" ||
      response.scopeKind === "feed" ||
      response.scopeKind === "antenna") &&
    typeof response.pageTitle === "string"
  );
}
