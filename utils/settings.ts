// What a setting is and what a valid one looks like. Where they are kept is
// utils/settings-storage.ts — kept apart so this file stays readable by the
// build scripts, which run under node and have no extension APIs at all
// (scripts/verify-manifest.ts reaches this file through the adapters).
import type { ClassifyThresholds } from "./filter-core.ts";
import { normalizeInstanceHost } from "./instances.ts";

// Every value is widened past its own literal (`as boolean`, not left to
// infer as `true`) — Object.freeze()'s generic parameter otherwise infers
// each property at its narrowest literal type, which normalizeSettings()
// could never legally return to (a computed `boolean` is never a `true`).
export const defaults = Object.freeze({
  enabled: true as boolean,
  minLikes: 500 as number,
  risingEnabled: true as boolean,
  risingMinLikes: 100 as number,
  risingMaxAgeHours: 6 as number,
  mediaMode: "any" as "any" | "images",
  hideReposts: true as boolean,
  misskeyInstances: Object.freeze([]) as readonly string[],
  // Misskey counts reactions, not likes, and instance sizes differ from X's by
  // orders of magnitude — one threshold across both services would leave one of
  // them permanently empty or permanently unfiltered (see #2's issue comment,
  // section 4). These two numbers come from the reaction counts actually
  // observed on media-bearing notes older than two days: 20 keeps the top
  // ~7-15% of them, and 5 within the rising window is the same wider net X's
  // 100-of-500 draws (measured 2026-08-05 on misskey.io and misskey.design).
  misskeyMinReactions: 20 as number,
  misskeyRisingMinReactions: 5 as number,
});

// Derived from `defaults` rather than declared a second time, so the two
// cannot drift apart — a field added to `defaults` is a field this type gains
// for free.
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

// Re-validated on every read, not just on write: storage can hold whatever an
// older version of this extension put there, or whatever chrome://extensions
// left behind after a permission was revoked out of step with settings.
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

export function normalizeSettings(value: unknown): Settings {
  const source: Partial<Record<keyof Settings, unknown>> =
    value && typeof value === "object" ? value : {};

  return {
    enabled: source.enabled !== false,
    minLikes: clampInteger(source.minLikes, defaults.minLikes, 0, 1000000000),
    risingEnabled: source.risingEnabled !== false,
    risingMinLikes: clampInteger(
      source.risingMinLikes,
      defaults.risingMinLikes,
      0,
      1000000000,
    ),
    risingMaxAgeHours: clampInteger(
      source.risingMaxAgeHours,
      defaults.risingMaxAgeHours,
      1,
      168,
    ),
    mediaMode: source.mediaMode === "images" ? "images" : "any",
    hideReposts: source.hideReposts !== false,
    misskeyInstances: normalizeInstanceList(source.misskeyInstances),
    misskeyMinReactions: clampInteger(
      source.misskeyMinReactions,
      defaults.misskeyMinReactions,
      0,
      1000000000,
    ),
    misskeyRisingMinReactions: clampInteger(
      source.misskeyRisingMinReactions,
      defaults.misskeyRisingMinReactions,
      0,
      1000000000,
    ),
  };
}

// Which pair of stored numbers a service's reaction count is compared against.
// The adapter names the pair (utils/adapters/types.ts) and the settings surfaces
// bind their inputs to the same keys, so the toolbar on a Misskey page edits
// Misskey's thresholds without knowing which service it is on.
export interface ThresholdKeys {
  readonly minReactions: "minLikes" | "misskeyMinReactions";
  readonly risingMinReactions: "risingMinLikes" | "misskeyRisingMinReactions";
}

// Any one of those four settings, for code that handles a threshold without
// caring which of the pair it is.
export type ThresholdKey = ThresholdKeys[keyof ThresholdKeys];

// X and Bluesky share these: a like means the same thing on both.
export const LIKE_THRESHOLDS: ThresholdKeys = Object.freeze({
  minReactions: "minLikes",
  risingMinReactions: "risingMinLikes",
});

export const MISSKEY_REACTION_THRESHOLDS: ThresholdKeys = Object.freeze({
  minReactions: "misskeyMinReactions",
  risingMinReactions: "misskeyRisingMinReactions",
});

// The thresholds classifyPost() takes, filled in from the service's own pair.
// Everything else about the classification — the rising window, the media mode,
// whether reposts are dropped — is one setting shared by every service.
export function thresholdsFor(
  settings: Settings,
  keys: ThresholdKeys,
): ClassifyThresholds {
  return {
    hideReposts: settings.hideReposts,
    minLikes: settings[keys.minReactions],
    risingEnabled: settings.risingEnabled,
    risingMinLikes: settings[keys.risingMinReactions],
    risingMaxAgeHours: settings.risingMaxAgeHours,
  };
}
