// 設定とは何で、正しい設定とはどういうものか。保管場所は settings-storage.ts。
import type { ClassifyThresholds } from "./filter-core.ts";

export type MediaMode = "any" | "images" | "video";
export type ReactionSiteSettingsKey = "x" | "bluesky";
export type MetricSiteSettingsKey = "youtube" | "niconico";
export type SiteSettingsKey = ReactionSiteSettingsKey | MetricSiteSettingsKey;

export interface ReactionSiteSettings {
  readonly manualMinimum?: number;
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
  readonly postedWithinDays?: number;
  readonly manualPeriodDays?: number;
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

function defaultMetricSiteSettings(): Readonly<MetricSiteSettings> {
  return Object.freeze({ kind: "metric" });
}

export const defaults: Readonly<Settings> = Object.freeze({
  siteSettings: Object.freeze({
    x: defaultReactionSiteSettings(1000),
    bluesky: defaultReactionSiteSettings(1000),
    youtube: defaultMetricSiteSettings(),
    niconico: defaultMetricSiteSettings(),
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

function normalizeReactionSiteSettings(
  value: unknown,
  fallback: ReactionSiteSettings,
): ReactionSiteSettings {
  const source = objectSource(value);
  const mediaMode = normalizeMediaMode(source.mediaMode, fallback.mediaMode);
  return {
    ...(source.manualMinimum === undefined
      ? {}
      : {
          manualMinimum: clampInteger(
            source.manualMinimum,
            fallback.minReactions,
            0,
            1000000000,
          ),
        }),
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

function normalizeMetricSiteSettings(value: unknown): MetricSiteSettings {
  const source = objectSource(value);
  return {
    kind: "metric",
    ...(source.postedWithinDays === undefined
      ? {}
      : {
          postedWithinDays: clampInteger(source.postedWithinDays, 0, 0, 36500),
        }),
    ...(source.manualPeriodDays === undefined
      ? {}
      : {
          manualPeriodDays: clampInteger(source.manualPeriodDays, 30, 1, 36500),
        }),
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
    youtube: normalizeMetricSiteSettings(storedSiteSettings.youtube),
    niconico: normalizeMetricSiteSettings(storedSiteSettings.niconico),
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

export function thresholdsFor(
  settings: SiteSettings,
  sortOrder?: string,
): ClassifyThresholds {
  if (settings.kind === "metric") {
    return {
      mediaEnabled: false,
      hideReplies: false,
      hideQuotes: false,
      hideReposts: false,
      inclusion: {
        minimum: null,
        maximumAgeHours:
          sortOrder === "popular" && settings.postedWithinDays
            ? settings.postedWithinDays * 24
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
    },
  };
}
