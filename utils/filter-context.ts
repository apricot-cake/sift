import { isPageHealth, type PageHealth } from "./page-health.ts";
import type { SiteSettingsKey } from "./settings.ts";

export const FILTER_CONTEXT_REQUEST = "sift:get-filter-context";
export const FILTER_CONTEXT_METRIC_LIMIT = 1_000;

export interface FilterContextRequest {
  readonly type: typeof FILTER_CONTEXT_REQUEST;
}

export interface FilterContextResponse {
  readonly health?: PageHealth;
  readonly supportsPublicationAge?: boolean;
  readonly sortOrder?:
    | "newest"
    | "popular"
    | "relevance"
    | "default"
    | "unknown";
  readonly site: SiteSettingsKey;
  readonly pageTitle: string;
  readonly pageKey: string;
  readonly timelineAvailable: boolean;
  readonly filteringEnabled: boolean;
  readonly continuousLoadingWarning: boolean;
  readonly metricContextTruncated?: boolean;
  /** 最低値を除いた現在の条件に合う、パネル集計用サンプルの投稿数。 */
  readonly metricSampleCount: number;
  /** 上記サンプルのうち、指標を読めた投稿の指標値。 */
  readonly metricCounts: readonly number[];
  /**
   * 最低値を除いた現在の条件に合う投稿の公開日時。日付を読めない投稿は
   * 入れないので、`metricCounts` と同じ長さであるとは限らない。
   */
  readonly metricCreatedAtMs: readonly number[];
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
    (response.supportsPublicationAge === undefined ||
      typeof response.supportsPublicationAge === "boolean") &&
    (response.sortOrder === undefined ||
      response.sortOrder === "newest" ||
      response.sortOrder === "popular" ||
      response.sortOrder === "relevance" ||
      response.sortOrder === "default" ||
      response.sortOrder === "unknown") &&
    (response.site === "x" ||
      response.site === "bluesky" ||
      response.site === "youtube" ||
      response.site === "niconico") &&
    typeof response.pageTitle === "string" &&
    typeof response.pageKey === "string" &&
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
    ) &&
    Array.isArray(response.metricCreatedAtMs) &&
    response.metricCreatedAtMs.length <= response.metricSampleCount &&
    response.metricCreatedAtMs.length <= FILTER_CONTEXT_METRIC_LIMIT &&
    response.metricCreatedAtMs.every((createdAtMs) =>
      Number.isSafeInteger(createdAtMs),
    )
  );
}
