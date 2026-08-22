// 設定とは何で、正しい設定とはどういうものか。保管場所は settings-storage.ts。
import type { ClassifyThresholds } from "./filter-core.ts";

export type MediaMode = "all" | "any" | "images" | "video";
export type PeriodMode = "all" | "limited";
export type PeriodUnit = "hour" | "day" | "week" | "month" | "year";
export type ReactionSiteSettingsKey = "x" | "bluesky" | "misskey";
export type SiteSettingsKey = ReactionSiteSettingsKey | "youtube";

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

export interface YouTubeSiteSettings {
  readonly kind: "youtube";
  readonly minViewsEnabled: boolean;
  readonly minViews: number;
  readonly periodMode: PeriodMode;
  readonly periodValue: number;
  readonly periodUnit: PeriodUnit;
}

export interface SiteSettingsMap {
  readonly x: ReactionSiteSettings;
  readonly bluesky: ReactionSiteSettings;
  readonly misskey: ReactionSiteSettings;
  readonly youtube: YouTubeSiteSettings;
}

export type SiteSettings = SiteSettingsMap[SiteSettingsKey];

export type SettingsScopeKind =
  | "following"
  | "home"
  | "list"
  | "feed"
  | "antenna";

export interface SettingsScope {
  readonly key: string;
  readonly kind: SettingsScopeKind;
}

export interface SourceSettingsEntry {
  readonly site: SiteSettingsKey;
  readonly label: string;
  readonly settings: SiteSettings;
}

export interface Settings {
  readonly siteEnabled: {
    readonly defaultEnabled: boolean;
    readonly hosts: Readonly<Record<string, boolean>>;
  };
  readonly siteSettings: SiteSettingsMap;
  readonly sourceSettings: Readonly<Record<string, SourceSettingsEntry>>;
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

const defaultYouTubeSiteSettings: Readonly<YouTubeSiteSettings> = Object.freeze(
  {
    kind: "youtube",
    minViewsEnabled: true,
    minViews: 10000,
    periodMode: "all",
    periodValue: 1,
    periodUnit: "week",
  },
);

export const defaults: Readonly<Settings> = Object.freeze({
  siteEnabled: Object.freeze({
    defaultEnabled: true,
    hosts: Object.freeze({}) as Readonly<Record<string, boolean>>,
  }),
  siteSettings: Object.freeze({
    x: defaultReactionSiteSettings(1000),
    bluesky: defaultReactionSiteSettings(1000),
    misskey: defaultReactionSiteSettings(20),
    youtube: defaultYouTubeSiteSettings,
  }),
  sourceSettings: Object.freeze({}),
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

function normalizeHostname(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  if (value === "" || value.includes(":") || value.includes("/")) {
    return null;
  }
  try {
    return new URL(`https://${value}`).hostname || null;
  } catch {
    return null;
  }
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
    const host = normalizeHostname(entry);
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
  const legacyLimitedOnly =
    source.periodMode === undefined &&
    source.minReactionsEnabled === false &&
    source.risingEnabled === true;
  const excludedKeywords =
    source.excludedKeywords === undefined
      ? fallback.excludedKeywords
      : normalizeExcludedKeywords(source.excludedKeywords);
  return {
    kind: "reactions",
    mediaEnabled:
      typeof source.mediaEnabled === "boolean"
        ? source.mediaEnabled
        : source.mediaMode === undefined
          ? fallback.mediaEnabled
          : mediaMode !== "all",
    mediaMode,
    minReactionsEnabled:
      legacyLimitedOnly || source.minReactionsEnabled === true
        ? true
        : source.minReactionsEnabled === false
          ? false
          : fallback.minReactionsEnabled,
    minReactions: clampInteger(
      legacyLimitedOnly ? source.risingMinReactions : source.minReactions,
      fallback.minReactions,
      0,
      1000000000,
    ),
    periodMode: normalizePeriodMode(
      source.periodMode,
      legacyLimitedOnly ? "limited" : fallback.periodMode,
    ),
    periodValue: clampInteger(
      source.periodValue ??
        (legacyLimitedOnly ? source.risingMaxAgeHours : undefined),
      fallback.periodValue,
      1,
      1000,
    ),
    periodUnit: normalizePeriodUnit(source.periodUnit, fallback.periodUnit),
    excludedKeywordsEnabled:
      typeof source.excludedKeywordsEnabled === "boolean"
        ? source.excludedKeywordsEnabled
        : source.excludedKeywords === undefined
          ? fallback.excludedKeywordsEnabled
          : excludedKeywords !== "",
    excludedKeywords,
    hideReposts:
      typeof source.hideReposts === "boolean"
        ? source.hideReposts
        : fallback.hideReposts,
  };
}

function normalizeYouTubeSiteSettings(
  value: unknown,
  fallback: YouTubeSiteSettings,
): YouTubeSiteSettings {
  const source = objectSource(value);
  const legacyLimitedOnly =
    source.periodMode === undefined &&
    source.minViewsEnabled === false &&
    source.viewRateEnabled === true;
  return {
    kind: "youtube",
    minViewsEnabled:
      legacyLimitedOnly || source.minViewsEnabled === true
        ? true
        : source.minViewsEnabled === false
          ? false
          : fallback.minViewsEnabled,
    minViews: clampInteger(
      legacyLimitedOnly ? source.minViewsPerDay : source.minViews,
      fallback.minViews,
      0,
      1000000000,
    ),
    periodMode: normalizePeriodMode(
      source.periodMode,
      legacyLimitedOnly ? "limited" : fallback.periodMode,
    ),
    periodValue: clampInteger(
      source.periodValue,
      legacyLimitedOnly ? 1 : fallback.periodValue,
      1,
      1000,
    ),
    periodUnit: normalizePeriodUnit(
      source.periodUnit,
      legacyLimitedOnly ? "day" : fallback.periodUnit,
    ),
  };
}

function isSiteSettingsKey(value: unknown): value is SiteSettingsKey {
  return (
    value === "x" ||
    value === "bluesky" ||
    value === "misskey" ||
    value === "youtube"
  );
}

function sourceSettingsStorageKey(
  site: SiteSettingsKey,
  scopeKey: string,
): string {
  return `${site}:${scopeKey}`;
}

function normalizeSourceSettings(
  value: unknown,
  siteSettings: SiteSettingsMap,
): Readonly<Record<string, SourceSettingsEntry>> {
  const normalized: Record<string, SourceSettingsEntry> = {};
  for (const [storageKey, rawEntry] of Object.entries(objectSource(value))) {
    const entry = objectSource(rawEntry);
    const site = entry.site;
    const separator = storageKey.indexOf(":");
    const scopeKey = separator < 0 ? "" : storageKey.slice(separator + 1);
    if (
      !isSiteSettingsKey(site) ||
      storageKey !== sourceSettingsStorageKey(site, scopeKey) ||
      scopeKey === "" ||
      scopeKey.length > 500
    ) {
      continue;
    }
    const label =
      typeof entry.label === "string" && entry.label.trim() !== ""
        ? entry.label.trim().slice(0, 100)
        : scopeKey;
    const settings =
      site === "youtube"
        ? normalizeYouTubeSiteSettings(entry.settings, siteSettings.youtube)
        : normalizeReactionSiteSettings(
            entry.settings,
            siteSettings[site] as ReactionSiteSettings,
          );
    normalized[storageKey] = { site, label, settings };
  }
  return normalized;
}

function legacyReactionSiteSettings(
  source: Record<string, unknown>,
  key: ReactionSiteSettingsKey,
): ReactionSiteSettings {
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
  return normalizeReactionSiteSettings(
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
  const normalizeReactionFor = (
    key: ReactionSiteSettingsKey,
  ): ReactionSiteSettings =>
    normalizeReactionSiteSettings(
      storedSiteSettings[key],
      legacyReactionSiteSettings(source, key),
    );

  const siteSettings: SiteSettingsMap = {
    x: normalizeReactionFor("x"),
    bluesky: normalizeReactionFor("bluesky"),
    misskey: normalizeReactionFor("misskey"),
    youtube: normalizeYouTubeSiteSettings(
      storedSiteSettings.youtube,
      defaults.siteSettings.youtube,
    ),
  };

  return {
    siteEnabled: normalizeSiteEnabled(
      source.siteEnabled,
      migratedDefaultEnabled,
    ),
    siteSettings,
    sourceSettings: normalizeSourceSettings(
      source.sourceSettings,
      siteSettings,
    ),
  };
}

export function isSiteEnabled(settings: Settings, hostname: string): boolean {
  const host = normalizeHostname(hostname);
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
  const host = normalizeHostname(hostname);
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

export function settingsFor<Key extends SiteSettingsKey>(
  settings: Settings,
  key: Key,
  scopeKey?: string | null,
): SiteSettingsMap[Key] {
  if (scopeKey) {
    const entry =
      settings.sourceSettings[sourceSettingsStorageKey(key, scopeKey)];
    if (
      entry?.site === key &&
      entry.settings.kind === settings.siteSettings[key].kind
    ) {
      return entry.settings as SiteSettingsMap[Key];
    }
  }
  return settings.siteSettings[key];
}

export function sourceSettingsFor(
  settings: Settings,
  site: SiteSettingsKey,
): readonly (SourceSettingsEntry & { readonly scopeKey: string })[] {
  const prefix = `${site}:`;
  return Object.entries(settings.sourceSettings)
    .filter(
      ([storageKey, entry]) =>
        storageKey.startsWith(prefix) && entry.site === site,
    )
    .map(([storageKey, entry]) => ({
      ...entry,
      scopeKey: storageKey.slice(prefix.length),
    }));
}

export function hasSourceSettings(
  settings: Settings,
  site: SiteSettingsKey,
  scopeKey: string,
): boolean {
  return Object.hasOwn(
    settings.sourceSettings,
    sourceSettingsStorageKey(site, scopeKey),
  );
}

export function withSourceSettings(
  settings: Settings,
  site: SiteSettingsKey,
  scopeKey: string,
  label: string,
  siteSettings: SiteSettings,
): Settings {
  const storageKey = sourceSettingsStorageKey(site, scopeKey);
  return normalizeSettings({
    ...settings,
    sourceSettings: {
      ...settings.sourceSettings,
      [storageKey]: { site, label, settings: siteSettings },
    },
  });
}

export function withoutSourceSettings(
  settings: Settings,
  site: SiteSettingsKey,
  scopeKey: string,
): Settings {
  const storageKey = sourceSettingsStorageKey(site, scopeKey);
  const sourceSettings = { ...settings.sourceSettings };
  delete sourceSettings[storageKey];
  return normalizeSettings({ ...settings, sourceSettings });
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
  if (settings.kind === "youtube") {
    return {
      mediaEnabled: false,
      excludedKeywords: [],
      hideReposts: false,
      inclusion: {
        enabled: settings.minViewsEnabled,
        minimum: settings.minViews,
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
