// 設定とは何で、正しい設定とはどういうものか。保管場所は settings-storage.ts。
import type { ClassifyThresholds } from "./filter-core.ts";

export type MediaMode = "all" | "any" | "images" | "video";
export type PeriodMode = "all" | "limited";
export type PeriodUnit = "hour" | "day" | "week" | "month" | "year";
export type ReactionSiteSettingsKey = "x" | "bluesky";
export type MetricSiteSettingsKey = "youtube" | "niconico";
export type SiteSettingsKey = ReactionSiteSettingsKey | MetricSiteSettingsKey;

export interface ReactionSiteSettings {
  readonly kind: "reactions";
  readonly mediaEnabled: boolean;
  readonly mediaMode: MediaMode;
  readonly minReactionsEnabled: boolean;
  readonly minReactions: number;
  readonly periodMode: PeriodMode;
  readonly periodValue: number;
  readonly periodUnit: PeriodUnit;
  readonly excludedKeywordsEnabled: boolean;
  readonly excludedKeywords: string;
  readonly hideReposts: boolean;
}

export interface MetricSiteSettings {
  readonly kind: "metric";
  readonly minCountEnabled: boolean;
  readonly minCount: number;
  readonly periodMode: PeriodMode;
  readonly periodValue: number;
  readonly periodUnit: PeriodUnit;
}

export interface SiteSettingsMap {
  readonly x: ReactionSiteSettings;
  readonly bluesky: ReactionSiteSettings;
  readonly youtube: MetricSiteSettings;
  readonly niconico: MetricSiteSettings;
}

export type SiteSettings = SiteSettingsMap[SiteSettingsKey];

export interface Settings {
  readonly siteSettings: SiteSettingsMap;
}

function defaultReactionSiteSettings(
  minReactions: number,
): Readonly<ReactionSiteSettings> {
  return Object.freeze({
    kind: "reactions",
    mediaEnabled: false,
    mediaMode: "all",
    minReactionsEnabled: true,
    minReactions,
    periodMode: "all",
    periodValue: 6,
    periodUnit: "hour",
    excludedKeywordsEnabled: false,
    excludedKeywords: "",
    hideReposts: true,
  });
}

function defaultMetricSiteSettings(
  minCount: number,
): Readonly<MetricSiteSettings> {
  return Object.freeze({
    kind: "metric",
    minCountEnabled: true,
    minCount,
    periodMode: "all",
    periodValue: 1,
    periodUnit: "week",
  });
}

export const defaults: Readonly<Settings> = Object.freeze({
  siteSettings: Object.freeze({
    x: defaultReactionSiteSettings(1000),
    bluesky: defaultReactionSiteSettings(1000),
    youtube: defaultMetricSiteSettings(10000),
    niconico: defaultMetricSiteSettings(1000),
  }),
});

function clampInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function normalizeExcludedKeywords(value: unknown): string {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const keyword = line.trim();
    const normalized = keyword.toLowerCase();
    if (keyword !== "" && !seen.has(normalized)) {
      seen.add(normalized);
      keywords.push(keyword);
    }
  }
  return keywords.join("\n");
}

export function excludedKeywordsFrom(value: string): readonly string[] {
  return normalizeExcludedKeywords(value)
    .split("\n")
    .filter(Boolean)
    .map((keyword) => keyword.toLowerCase());
}

function objectSource(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeMediaMode(value: unknown, fallback: MediaMode): MediaMode {
  if (
    value === "all" ||
    value === "any" ||
    value === "images" ||
    value === "video"
  ) {
    return value;
  }
  return fallback;
}

function normalizePeriodMode(value: unknown, fallback: PeriodMode): PeriodMode {
  return value === "all" || value === "limited" ? value : fallback;
}

function normalizePeriodUnit(value: unknown, fallback: PeriodUnit): PeriodUnit {
  if (
    value === "hour" ||
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "year"
  ) {
    return value;
  }
  return fallback;
}

function normalizeReactionSiteSettings(
  value: unknown,
  fallback: ReactionSiteSettings,
): ReactionSiteSettings {
  const source = objectSource(value);
  const mediaMode = normalizeMediaMode(source.mediaMode, fallback.mediaMode);
  const excludedKeywords =
    source.excludedKeywords === undefined
      ? fallback.excludedKeywords
      : normalizeExcludedKeywords(source.excludedKeywords);
  return {
    kind: "reactions",
    mediaEnabled:
      typeof source.mediaEnabled === "boolean"
        ? source.mediaEnabled
        : fallback.mediaEnabled,
    mediaMode,
    minReactionsEnabled:
      source.minReactionsEnabled === true
        ? true
        : source.minReactionsEnabled === false
          ? false
          : fallback.minReactionsEnabled,
    minReactions: clampInteger(
      source.minReactions,
      fallback.minReactions,
      0,
      1000000000,
    ),
    periodMode: normalizePeriodMode(source.periodMode, fallback.periodMode),
    periodValue: clampInteger(
      source.periodValue,
      fallback.periodValue,
      1,
      1000,
    ),
    periodUnit: normalizePeriodUnit(source.periodUnit, fallback.periodUnit),
    excludedKeywordsEnabled:
      typeof source.excludedKeywordsEnabled === "boolean"
        ? source.excludedKeywordsEnabled
        : fallback.excludedKeywordsEnabled,
    excludedKeywords,
    hideReposts:
      typeof source.hideReposts === "boolean"
        ? source.hideReposts
        : fallback.hideReposts,
  };
}

function normalizeMetricSiteSettings(
  value: unknown,
  fallback: MetricSiteSettings,
): MetricSiteSettings {
  const source = objectSource(value);
  return {
    kind: "metric",
    minCountEnabled:
      source.minCountEnabled === true
        ? true
        : source.minCountEnabled === false
          ? false
          : fallback.minCountEnabled,
    minCount: clampInteger(source.minCount, fallback.minCount, 0, 1000000000),
    periodMode: normalizePeriodMode(source.periodMode, fallback.periodMode),
    periodValue: clampInteger(
      source.periodValue,
      fallback.periodValue,
      1,
      1000,
    ),
    periodUnit: normalizePeriodUnit(source.periodUnit, fallback.periodUnit),
  };
}

export function normalizeSettings(value: unknown): Settings {
  const source = objectSource(value);
  const storedSiteSettings = objectSource(source.siteSettings);
  const normalizeReactionFor = (
    key: ReactionSiteSettingsKey,
  ): ReactionSiteSettings =>
    normalizeReactionSiteSettings(
      storedSiteSettings[key],
      defaults.siteSettings[key],
    );

  const siteSettings: SiteSettingsMap = {
    x: normalizeReactionFor("x"),
    bluesky: normalizeReactionFor("bluesky"),
    youtube: normalizeMetricSiteSettings(
      storedSiteSettings.youtube,
      defaults.siteSettings.youtube,
    ),
    niconico: normalizeMetricSiteSettings(
      storedSiteSettings.niconico,
      defaults.siteSettings.niconico,
    ),
  };

  return { siteSettings };
}

export function settingsFor<Key extends SiteSettingsKey>(
  settings: Settings,
  key: Key,
): SiteSettingsMap[Key] {
  return settings.siteSettings[key];
}

export function withSiteSettings(
  settings: Settings,
  key: SiteSettingsKey,
  siteSettings: SiteSettings,
): Settings {
  return normalizeSettings({
    ...settings,
    siteSettings: { ...settings.siteSettings, [key]: siteSettings },
  });
}

const HOURS_PER_PERIOD_UNIT: Readonly<Record<PeriodUnit, number>> =
  Object.freeze({
    hour: 1,
    day: 24,
    week: 24 * 7,
    month: 24 * 30,
    year: 24 * 365,
  });

export function periodInHours(value: number, unit: PeriodUnit): number {
  return value * HOURS_PER_PERIOD_UNIT[unit];
}

export function thresholdsFor(settings: SiteSettings): ClassifyThresholds {
  if (settings.kind === "metric") {
    return {
      mediaEnabled: false,
      excludedKeywords: [],
      hideReposts: false,
      inclusion: {
        enabled: settings.minCountEnabled,
        minimum: settings.minCount,
        maximumAgeHours:
          settings.periodMode === "all"
            ? null
            : periodInHours(settings.periodValue, settings.periodUnit),
      },
    };
  }
  return {
    mediaEnabled: settings.mediaEnabled,
    excludedKeywords: settings.excludedKeywordsEnabled
      ? excludedKeywordsFrom(settings.excludedKeywords)
      : [],
    hideReposts: settings.hideReposts,
    inclusion: {
      enabled: settings.minReactionsEnabled,
      minimum: settings.minReactions,
      maximumAgeHours:
        settings.periodMode === "all"
          ? null
          : periodInHours(settings.periodValue, settings.periodUnit),
    },
  };
}
