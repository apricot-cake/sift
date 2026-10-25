import { isPageHealth, type PageHealth } from "./page-health.ts";
import {
  isPanelPost,
  type PanelPost,
  POST_COLLECTION_LIMIT,
} from "./panel-post.ts";
import type { SiteSettingsKey } from "./settings.ts";

export const FILTER_CONTEXT_REQUEST = "sift:get-filter-context";
export const FILTER_CONTEXT_METRIC_LIMIT = 1_000;

export interface FilterContextRequest {
  readonly type: typeof FILTER_CONTEXT_REQUEST;
  readonly reset?: boolean;
}

export interface FilterContextResponse {
  readonly health?: PageHealth;
  readonly site: SiteSettingsKey;
  readonly pageTitle: string;
  readonly pageKey: string;
  readonly timelineKey?: string | null;
  readonly timelineAvailable: boolean;
  readonly posts: readonly PanelPost[];
  readonly collectedCount: number;
  readonly collectionTruncated: boolean;
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
    (value as { type?: unknown }).type === FILTER_CONTEXT_REQUEST &&
    ((value as { reset?: unknown }).reset === undefined ||
      typeof (value as { reset?: unknown }).reset === "boolean")
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
    !("filteringEnabled" in response) &&
    !("continuousLoadingWarning" in response) &&
    Number.isSafeInteger(response.collectedCount) &&
    (response.collectedCount ?? -1) >= 0 &&
    (response.collectedCount ?? Infinity) <= POST_COLLECTION_LIMIT &&
    typeof response.collectionTruncated === "boolean" &&
    Array.isArray(response.posts) &&
    response.posts.length <= (response.collectedCount ?? -1) &&
    response.posts.every(isPanelPost) &&
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
