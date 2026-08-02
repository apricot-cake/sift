
const unitMultipliers = Object.freeze({
  K: 1000,
  M: 1000000,
  B: 1000000000,
  "万": 10000,
  "億": 100000000
});

export function normalizeDigits(value) {
  return String(value ?? "").replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0)
  );
}

export function parseMetric(value) {
  const normalized = normalizeDigits(value)
    .replace(/\u00a0/g, " ")
    .trim();
  const match = normalized.match(/(\d[\d.,]*)\s*(万|億|[KMB])?/i);

  if (!match) {
    return 0;
  }

  const unit = match[2] ? match[2].toUpperCase() : "";
  let numericText = match[1];

  if (unit) {
    numericText = numericText.replace(",", ".");
  } else {
    numericText = numericText.replace(/[,.]/g, "");
  }

  const numericValue = Number.parseFloat(numericText);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round(numericValue * (unitMultipliers[unit] ?? 1));
}

export function classifyPost(post, settings, nowMs = Date.now()) {
  if (!post.hasMedia) {
    return { state: "hidden", reason: "no-media" };
  }

  if (settings.hideReposts && post.isRepost) {
    return { state: "hidden", reason: "repost" };
  }

  if (post.likeCount >= settings.minLikes) {
    return { state: "hit", reason: "minimum-likes" };
  }

  if (
    settings.risingEnabled &&
    Number.isFinite(post.createdAtMs) &&
    post.likeCount >= settings.risingMinLikes
  ) {
    const ageHours = (nowMs - post.createdAtMs) / 3600000;
    if (ageHours >= -0.1 && ageHours <= settings.risingMaxAgeHours) {
      return { state: "rising", reason: "rising" };
    }
  }

  return { state: "hidden", reason: "below-threshold" };
}
