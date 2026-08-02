import { normalizeInstanceHost } from "./instances.js";

export const defaults = Object.freeze({
  enabled: true,
  minLikes: 500,
  risingEnabled: true,
  risingMinLikes: 100,
  risingMaxAgeHours: 6,
  mediaMode: "any",
  hideReposts: true,
  misskeyInstances: Object.freeze([])
});

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

// Re-validated on every read, not just on write: storage can hold whatever an
// older version of this extension put there, or whatever chrome://extensions
// left behind after a permission was revoked out of step with settings.
function normalizeInstanceList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const hosts = [];
  for (const entry of value) {
    const host = normalizeInstanceHost(entry);
    if (host !== null && !seen.has(host)) {
      seen.add(host);
      hosts.push(host);
    }
  }
  return hosts;
}

export function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};

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
