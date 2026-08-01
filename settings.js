(function initializeSettings(globalObject) {
  "use strict";

  const defaults = Object.freeze({
    enabled: true,
    minLikes: 500,
    risingEnabled: true,
    risingMinLikes: 100,
    risingMaxAgeHours: 6,
    mediaMode: "any",
    hideReposts: true
  });

  function clampInteger(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  function normalizeSettings(value) {
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
      hideReposts: source.hideReposts !== false
    };
  }

  globalObject.XIFSettings = Object.freeze({
    defaults,
    normalizeSettings
  });
})(globalThis);
