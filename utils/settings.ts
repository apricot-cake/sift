// 設定とは何で、正しい設定とはどういうものか。保管場所は settings-storage.ts。
import type { ClassifyThresholds } from "./filter-core.ts";

export type MediaMode = "any" | "images" | "video";
export type SiteSettingsKey = "x" | "bluesky";

export interface ReactionSiteSettings {
  readonly manualMinimum?: number;
  readonly mediaEnabled: boolean;
  readonly mediaMode: MediaMode;
  readonly minReactionsEnabled: boolean;
  readonly minReactions: number;
  readonly hideReplies: boolean;
  readonly hideQuotes: boolean;
  readonly hideReposts: boolean;
}

export interface SiteSettingsMap {
  readonly x: ReactionSiteSettings;
  readonly bluesky: ReactionSiteSettings;
}

export type SiteSettings = SiteSettingsMap[SiteSettingsKey];

export interface Settings {
  readonly siteSettings: SiteSettingsMap;
}

function defaultReactionSiteSettings(
  minReactions: number,
): Readonly<ReactionSiteSettings> {
  return Object.freeze({
    mediaEnabled: false,
    mediaMode: "any",
    minReactionsEnabled: true,
    minReactions,
    hideReplies: false,
    hideQuotes: false,
    hideReposts: true,
  });
}

export const defaults: Readonly<Settings> = Object.freeze({
  siteSettings: Object.freeze({
    x: defaultReactionSiteSettings(1000),
    bluesky: defaultReactionSiteSettings(1000),
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

export function normalizeSettings(value: unknown): Settings {
  const source = objectSource(value);
  const storedSiteSettings = objectSource(source.siteSettings);
  const normalizeReactionFor = (key: SiteSettingsKey): ReactionSiteSettings =>
    normalizeReactionSiteSettings(
      storedSiteSettings[key],
      defaults.siteSettings[key],
    );

  const siteSettings: SiteSettingsMap = {
    x: normalizeReactionFor("x"),
    bluesky: normalizeReactionFor("bluesky"),
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

export function thresholdsFor(settings: SiteSettings): ClassifyThresholds {
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
