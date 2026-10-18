import { isPageHealth, type PageHealth } from "./page-health.ts";
import type { SiteSettingsKey } from "./settings.ts";

export const FILTER_CONTEXT_REQUEST = "sift:get-filter-context";
export const FILTER_CONTEXT_METRIC_LIMIT = 1_000;

export interface FilterContextRequest {
  readonly type: typeof FILTER_CONTEXT_REQUEST;
}

export interface FilterContextResponse {
  readonly health?: PageHealth;
  readonly site: SiteSettingsKey;
  readonly pageTitle: string;
  readonly pageKey: string;
  readonly timelineKey?: string | null;
  readonly timelineAvailable: boolean;
  readonly filteringEnabled: boolean;
  readonly continuousLoadingWarning: boolean;
  readonly metricContextTruncated?: boolean;
  /** 最低いいね数の条件を除いた現在の条件に合う、パネル集計用サンプルの投稿数。 */
  readonly metricSampleCount: number;
  /** 上記サンプルのうち、X / Bluesky の反応数を読めた投稿の反応数。 */
  readonly metricCounts: readonly number[];
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
    (response.health === undefined || isPageHealth(response.health)) &&
    (response.site === "x" || response.site === "bluesky") &&
    typeof response.pageTitle === "string" &&
    typeof response.pageKey === "string" &&
    (response.timelineKey === undefined ||
      response.timelineKey === null ||
      typeof response.timelineKey === "string") &&
    typeof response.timelineAvailable === "boolean" &&
    typeof response.filteringEnabled === "boolean" &&
    typeof response.continuousLoadingWarning === "boolean" &&
    (response.metricContextTruncated === undefined ||
      typeof response.metricContextTruncated === "boolean") &&
    typeof response.metricSampleCount === "number" &&
    Number.isSafeInteger(response.metricSampleCount) &&
    response.metricSampleCount >= 0 &&
    response.metricSampleCount <= FILTER_CONTEXT_METRIC_LIMIT &&
    Array.isArray(response.metricCounts) &&
    response.metricCounts.length <= response.metricSampleCount &&
    response.metricCounts.length <= FILTER_CONTEXT_METRIC_LIMIT &&
    response.metricCounts.every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    )
  );
}
