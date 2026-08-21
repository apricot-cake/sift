// 設定とは何で、正しい設定とはどういうものか。保管場所は settings-storage.ts。
import type { ClassifyThresholds } from "./filter-core.ts";
import { normalizeInstanceHost } from "./instances.ts";

export type MediaMode = "all" | "any" | "images" | "video";
export type SiteSettingsKey = "x" | "bluesky" | "misskey";

export interface SiteSettings {
  readonly mediaMode: MediaMode;
  readonly minReactions: number;
  readonly risingEnabled: boolean;
  readonly risingMinReactions: number;
  readonly risingMaxAgeHours: number;
  readonly excludedKeywords: string;
  readonly hideReposts: boolean;
}

function defaultSiteSettings(
  minReactions: number,
  risingMinReactions: number,
): Readonly<SiteSettings> {
  return Object.freeze({
    mediaMode: "all",
    minReactions,
    risingEnabled: true,
    risingMinReactions,
    risingMaxAgeHours: 6,
    excludedKeywords: "",
    hideReposts: true,
  });
}

export const defaults = Object.freeze({
  siteEnabled: Object.freeze({
    defaultEnabled: true as boolean,
    hosts: Object.freeze({}) as Readonly<Record<string, boolean>>,
  }),
  siteSettings: Object.freeze({
    x: defaultSiteSettings(500, 100),
    bluesky: defaultSiteSettings(500, 100),
    misskey: defaultSiteSettings(20, 5),
  }),
  misskeyInstances: Object.freeze([]) as readonly string[],
});

export type Settings = typeof defaults;

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

function normalizeInstanceList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const entry of value) {
    const host = normalizeInstanceHost(entry);
    if (host !== null && !seen.has(host)) {
      seen.add(host);
      hosts.push(host);
    }
  }
  return hosts;
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

function normalizeSiteEnabled(
  value: unknown,
  legacyEnabled: boolean,
): Settings["siteEnabled"] {
  const source = objectSource(value);
  const rawHosts = objectSource(source.hosts);
  const hosts: Record<string, boolean> = {};
  for (const [entry, enabled] of Object.entries(rawHosts)) {
    const host = normalizeInstanceHost(entry);
    if (host !== null && typeof enabled === "boolean") {
      hosts[host] = enabled;
    }
  }
  return {
    defaultEnabled: source.defaultEnabled === false ? false : legacyEnabled,
    hosts,
  };
}

function objectSource(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeSiteSettings(
  value: unknown,
  fallback: SiteSettings,
): SiteSettings {
  const source = objectSource(value);
  return {
    mediaMode:
      source.mediaMode === "any" ||
      source.mediaMode === "images" ||
      source.mediaMode === "video"
        ? source.mediaMode
        : source.mediaMode === "all"
          ? "all"
          : fallback.mediaMode,
    minReactions: clampInteger(
      source.minReactions,
      fallback.minReactions,
      0,
      1000000000,
    ),
    risingEnabled:
      typeof source.risingEnabled === "boolean"
        ? source.risingEnabled
        : fallback.risingEnabled,
    risingMinReactions: clampInteger(
      source.risingMinReactions,
      fallback.risingMinReactions,
      0,
      1000000000,
    ),
    risingMaxAgeHours: clampInteger(
      source.risingMaxAgeHours,
      fallback.risingMaxAgeHours,
      1,
      168,
    ),
    excludedKeywords:
      source.excludedKeywords === undefined
        ? fallback.excludedKeywords
        : normalizeExcludedKeywords(source.excludedKeywords),
    hideReposts:
      typeof source.hideReposts === "boolean"
        ? source.hideReposts
        : fallback.hideReposts,
  };
}

function legacySiteSettings(
  source: Record<string, unknown>,
  key: SiteSettingsKey,
): SiteSettings {
  const defaultsForSite = defaults.siteSettings[key];
  const minReactions =
    key === "misskey"
      ? source.misskeyMinReactions
      : key === "bluesky"
        ? (source.blueskyMinLikes ?? source.minLikes)
        : (source.xMinLikes ?? source.minLikes);
  const risingMinReactions =
    key === "misskey"
      ? source.misskeyRisingMinReactions
      : key === "bluesky"
        ? (source.blueskyRisingMinLikes ?? source.risingMinLikes)
        : (source.xRisingMinLikes ?? source.risingMinLikes);
  return normalizeSiteSettings(
    {
      mediaMode: source.mediaMode,
      minReactions,
      risingEnabled: source.risingEnabled,
      risingMinReactions,
      risingMaxAgeHours: source.risingMaxAgeHours,
      excludedKeywords: source.excludedKeywords,
      hideReposts: source.hideReposts,
    },
    defaultsForSite,
  );
}

export function normalizeSettings(value: unknown): Settings {
  const source = objectSource(value);
  const migratedDefaultEnabled = !(
    !Object.hasOwn(source, "siteEnabled") && source.enabled === false
  );
  const storedSiteSettings = objectSource(source.siteSettings);
  const normalizeFor = (key: SiteSettingsKey): SiteSettings =>
    normalizeSiteSettings(
      storedSiteSettings[key],
      legacySiteSettings(source, key),
    );

  return {
    siteEnabled: normalizeSiteEnabled(
      source.siteEnabled,
      migratedDefaultEnabled,
    ),
    siteSettings: {
      x: normalizeFor("x"),
      bluesky: normalizeFor("bluesky"),
      misskey: normalizeFor("misskey"),
    },
    misskeyInstances: normalizeInstanceList(source.misskeyInstances),
  };
}

export function isSiteEnabled(settings: Settings, hostname: string): boolean {
  const host = normalizeInstanceHost(hostname);
  if (host === null) {
    return settings.siteEnabled.defaultEnabled;
  }
  return (
    settings.siteEnabled.hosts[host] ?? settings.siteEnabled.defaultEnabled
  );
}

export function withSiteEnabled(
  settings: Settings,
  hostname: string,
  enabled: boolean,
): Settings {
  const host = normalizeInstanceHost(hostname);
  if (host === null) {
    return settings;
  }
  return normalizeSettings({
    ...settings,
    siteEnabled: {
      defaultEnabled: settings.siteEnabled.defaultEnabled,
      hosts: { ...settings.siteEnabled.hosts, [host]: enabled },
    },
  });
}

export function settingsFor(
  settings: Settings,
  key: SiteSettingsKey,
): SiteSettings {
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
    excludedKeywords: excludedKeywordsFrom(settings.excludedKeywords),
    hideReposts: settings.hideReposts,
    minLikes: settings.minReactions,
    risingEnabled: settings.risingEnabled,
    risingMinLikes: settings.risingMinReactions,
    risingMaxAgeHours: settings.risingMaxAgeHours,
  };
}
