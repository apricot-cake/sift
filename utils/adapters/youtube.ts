import { normalizeDigits, parseMetric } from "../filter-core.ts";
import type { ServiceAdapter } from "./types.ts";

const YOUTUBE_SELECTORS = Object.freeze({
  videoCard: [
    "ytd-video-renderer",
    "ytd-rich-grid-media",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-reel-item-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
  ].join(", "),
  cell: "ytd-rich-item-renderer",
  title:
    "a#video-title, a#video-title-link, a.shortsLockupViewModelHostEndpoint, h3 a[href]",
  metadata:
    "#metadata-line span, .inline-metadata-item, .ytContentMetadataViewModelMetadataText, [class*='MetadataSubhead'], [class*='metadata-subhead']",
});

const VIEW_LABEL =
  /(?:views?|回視聴|回再生|조회수|次觀看|次观看|visualizaciones?|visualiza(?:ç|c)[õo]es?)/i;

const AGE_IN_MILLISECONDS: Readonly<Record<string, number>> = Object.freeze({
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30.4375 * 24 * 60 * 60 * 1000,
  year: 365.25 * 24 * 60 * 60 * 1000,
});

const CHANNEL_FILTER_PATH =
  /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(?:videos|shorts)\/?$/;
const CHANNEL_ROOT_PATH =
  /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/;

export function isYouTubeFilterPage(pathname: string): boolean {
  return (
    pathname === "/results" ||
    pathname === "/feed/subscriptions" ||
    CHANNEL_FILTER_PATH.test(pathname)
  );
}

function isYouTubeChannelGridPage(root: ParentNode, pathname: string): boolean {
  return (
    CHANNEL_ROOT_PATH.test(pathname) &&
    Boolean(root.querySelector("ytd-rich-grid-renderer"))
  );
}

function amountFrom(value: string): number {
  return Number.parseFloat(normalizeDigits(value).replace(",", "."));
}

function timestampFromMatch(
  match: RegExpMatchArray | null,
  units: Readonly<Record<string, keyof typeof AGE_IN_MILLISECONDS>>,
  nowMs: number,
): number {
  if (!match?.[1] || !match[2]) {
    return Number.NaN;
  }
  const amount = amountFrom(match[1]);
  const unit = units[match[2].toLowerCase()];
  if (!Number.isFinite(amount) || unit === undefined) {
    return Number.NaN;
  }
  const unitDuration = AGE_IN_MILLISECONDS[unit];
  return unitDuration === undefined
    ? Number.NaN
    : nowMs - amount * unitDuration;
}

export function publishedAtFromYouTubeText(
  value: string,
  nowMs = Date.now(),
): number {
  const text = normalizeDigits(value).trim();
  const english = timestampFromMatch(
    text.match(
      /(\d+(?:[.,]\d+)?)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago/i,
    ),
    {
      second: "second",
      seconds: "second",
      minute: "minute",
      minutes: "minute",
      hour: "hour",
      hours: "hour",
      day: "day",
      days: "day",
      week: "week",
      weeks: "week",
      month: "month",
      months: "month",
      year: "year",
      years: "year",
    },
    nowMs,
  );
  if (Number.isFinite(english)) {
    return english;
  }

  const eastAsian = timestampFromMatch(
    text.match(
      /(\d+(?:[.,]\d+)?)\s*(秒|分|時間|小時|小时|日|天|週間|週|周|か月|ヶ月|個月|个月|月|年)\s*前/,
    ),
    {
      秒: "second",
      分: "minute",
      時間: "hour",
      小時: "hour",
      小时: "hour",
      日: "day",
      天: "day",
      週間: "week",
      週: "week",
      周: "week",
      か月: "month",
      ヶ月: "month",
      個月: "month",
      个月: "month",
      月: "month",
      年: "year",
    },
    nowMs,
  );
  if (Number.isFinite(eastAsian)) {
    return eastAsian;
  }

  const korean = timestampFromMatch(
    text.match(/(\d+(?:[.,]\d+)?)\s*(초|분|시간|일|주|개월|년)\s*전/),
    {
      초: "second",
      분: "minute",
      시간: "hour",
      일: "day",
      주: "week",
      개월: "month",
      년: "year",
    },
    nowMs,
  );
  if (Number.isFinite(korean)) {
    return korean;
  }

  const spanish = timestampFromMatch(
    text.match(
      /hace\s+(\d+(?:[.,]\d+)?)\s*(segundos?|minutos?|horas?|d[ií]as?|semanas?|meses?|a[ñn]os?)/i,
    ),
    {
      segundo: "second",
      segundos: "second",
      minuto: "minute",
      minutos: "minute",
      hora: "hour",
      horas: "hour",
      dia: "day",
      dias: "day",
      día: "day",
      días: "day",
      semana: "week",
      semanas: "week",
      mes: "month",
      meses: "month",
      ano: "year",
      anos: "year",
      año: "year",
      años: "year",
    },
    nowMs,
  );
  if (Number.isFinite(spanish)) {
    return spanish;
  }

  return timestampFromMatch(
    text.match(
      /h[aá]\s+(\d+(?:[.,]\d+)?)\s*(segundos?|minutos?|horas?|dias?|semanas?|meses?|anos?)/i,
    ),
    {
      segundo: "second",
      segundos: "second",
      minuto: "minute",
      minutos: "minute",
      hora: "hour",
      horas: "hour",
      dia: "day",
      dias: "day",
      semana: "week",
      semanas: "week",
      mes: "month",
      meses: "month",
      ano: "year",
      anos: "year",
    },
    nowMs,
  );
}

function metadataTexts(postCard: Element): string[] {
  return Array.from(postCard.querySelectorAll(YOUTUBE_SELECTORS.metadata))
    .map((element) => (element.textContent ?? "").trim())
    .filter(Boolean);
}

export const youtubeAdapter = Object.freeze({
  id: "youtube",
  matches: Object.freeze(["https://www.youtube.com/*"]),
  settingsKey: "youtube",

  getPostCards(root: ParentNode) {
    const cells = new Set<Element>();
    return Array.from(
      root.querySelectorAll(YOUTUBE_SELECTORS.videoCard),
    ).filter((postCard) => {
      const cell = postCard.closest(YOUTUBE_SELECTORS.cell) || postCard;
      if (cells.has(cell)) {
        return false;
      }
      cells.add(cell);
      return true;
    });
  },

  hasPostCards(root: ParentNode) {
    return Boolean(root.querySelector(YOUTUBE_SELECTORS.videoCard));
  },

  isTimelineAvailable(root: ParentNode, page: Pick<Location, "pathname">) {
    return (
      (isYouTubeFilterPage(page.pathname) ||
        isYouTubeChannelGridPage(root, page.pathname)) &&
      this.hasPostCards(root)
    );
  },

  settingsScope() {
    return null;
  },

  findPostCell(postCard: Element) {
    return postCard.closest(YOUTUBE_SELECTORS.cell) || postCard;
  },

  readMetricCount(postCard: Element) {
    const text = metadataTexts(postCard).find((entry) =>
      VIEW_LABEL.test(entry),
    );
    return text === undefined ? Number.NaN : parseMetric(text);
  },

  readCreatedAt(postCard: Element) {
    for (const text of metadataTexts(postCard)) {
      const timestamp = publishedAtFromYouTubeText(text);
      if (Number.isFinite(timestamp)) {
        return timestamp;
      }
    }
    return Number.NaN;
  },

  readMedia(_postCard: Element) {
    return { hasImage: false, hasVideo: true };
  },

  readText(postCard: Element) {
    return (
      postCard.querySelector(YOUTUBE_SELECTORS.title)?.textContent ?? ""
    ).trim();
  },

  readIsRepost(_postCard: Element) {
    return false;
  },
}) satisfies ServiceAdapter;
