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
  misskeyInstances: Object.freeze([]) as readonly string[]
});

// Derived from `defaults` rather than declared a second time, so the two
// cannot drift apart — a field added to `defaults` is a field this type gains
// for free.
export type Settings = typeof defaults;

function clampInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
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
      1000000000
    ),
    risingMaxAgeHours: clampInteger(
      source.risingMaxAgeHours,
      defaults.risingMaxAgeHours,
      1,
      168
    ),
    mediaMode: source.mediaMode === "images" ? "images" : "any",
    hideReposts: source.hideReposts !== false,
    misskeyInstances: normalizeInstanceList(source.misskeyInstances)
  };
}
