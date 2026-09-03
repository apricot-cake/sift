// 設定とは何で、正しい設定とはどういうものか。保管場所は settings-storage.ts。
import type { ClassifyThresholds } from "./filter-core.ts";

export type MediaMode = "any" | "images" | "video";
export type PublicationPeriodUnit = "hour" | "day" | "week" | "month" | "year";
export type ReactionSiteSettingsKey = "x" | "bluesky";
export type MetricSiteSettingsKey = "youtube" | "niconico";
export type SiteSettingsKey = ReactionSiteSettingsKey | MetricSiteSettingsKey;

export interface ReactionSiteSettings {
  readonly kind: "reactions";
  readonly mediaEnabled: boolean;
  readonly mediaMode: MediaMode;
  readonly minReactionsEnabled: boolean;
  readonly minReactions: number;
  readonly hideReplies: boolean;
  readonly hideQuotes: boolean;
  readonly hideReposts: boolean;
}

export interface MetricSiteSettings {
  readonly kind: "metric";
  readonly minCountEnabled: boolean;
  readonly minCount: number;
  readonly publishedWithinEnabled: boolean;
  readonly publishedWithinValue: number;
  readonly publishedWithinUnit: PublicationPeriodUnit;
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
    mediaMode: "any",
    minReactionsEnabled: true,
    minReactions,
    hideReplies: false,
    hideQuotes: false,
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
    publishedWithinEnabled: false,
    publishedWithinValue: 1,
    publishedWithinUnit: "week",
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

function objectSource(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeMediaMode(value: unknown, fallback: MediaMode): MediaMode {
  if (value === "any" || value === "images" || value === "video") {
    return value;
  }
  return fallback;
}

function normalizePublicationPeriodUnit(
  value: unknown,
  fallback: PublicationPeriodUnit,
): PublicationPeriodUnit {
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
    hideReplies:
      typeof source.hideReplies === "boolean"
        ? source.hideReplies
        : fallback.hideReplies,
    hideQuotes:
      typeof source.hideQuotes === "boolean"
        ? source.hideQuotes
        : fallback.hideQuotes,
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
    publishedWithinEnabled:
      typeof source.publishedWithinEnabled === "boolean"
        ? source.publishedWithinEnabled
        : fallback.publishedWithinEnabled,
    publishedWithinValue: clampInteger(
      source.publishedWithinValue,
      fallback.publishedWithinValue,
      1,
      1000,
    ),
    publishedWithinUnit: normalizePublicationPeriodUnit(
      source.publishedWithinUnit,
      fallback.publishedWithinUnit,
    ),
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

const HOURS_PER_PUBLICATION_PERIOD_UNIT: Readonly<
  Record<PublicationPeriodUnit, number>
> = Object.freeze({
  hour: 1,
  day: 24,
  week: 24 * 7,
  month: 24 * 30,
  year: 24 * 365,
});

export function publicationPeriodInHours(
  value: number,
  unit: PublicationPeriodUnit,
): number {
  return value * HOURS_PER_PUBLICATION_PERIOD_UNIT[unit];
}

export function thresholdsFor(settings: SiteSettings): ClassifyThresholds {
  if (settings.kind === "metric") {
    return {
      mediaEnabled: false,
      hideReplies: false,
      hideQuotes: false,
      hideReposts: false,
      inclusion: {
        minimum: settings.minCountEnabled ? settings.minCount : null,
        maximumAgeHours: settings.publishedWithinEnabled
          ? publicationPeriodInHours(
              settings.publishedWithinValue,
              settings.publishedWithinUnit,
            )
          : null,
      },
    };
  }
  return {
    mediaEnabled: settings.mediaEnabled,
    hideReplies: settings.hideReplies,
    hideQuotes: settings.hideQuotes,
    hideReposts: settings.hideReposts,
    inclusion: {
      minimum: settings.minReactionsEnabled ? settings.minReactions : null,
      maximumAgeHours: null,
    },
  };
}
