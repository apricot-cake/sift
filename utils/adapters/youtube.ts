import { normalizeDigits } from "../filter-core.ts";
import { collectMetricCards } from "./metric-cards.ts";
import type { ServiceAdapter } from "./types.ts";

const YOUTUBE_SELECTORS = Object.freeze({
  videoCard: [
    "ytd-video-renderer",
    "ytd-rich-grid-media",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "yt-lockup-view-model",
  ].join(", "),
  cell: "ytd-rich-item-renderer",
  title: "a#video-title, a#video-title-link, h3 a[href]",
  metadata:
    "#metadata-line span, .inline-metadata-item, .ytContentMetadataViewModelMetadataText, [class*='MetadataSubhead'], [class*='metadata-subhead']",
});

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
  /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(?:videos|streams)\/?$/;

export function isYouTubeFilterPage(pathname: string): boolean {
  return CHANNEL_FILTER_PATH.test(pathname);
}

export function readYouTubeSortOrder(
  root: ParentNode,
  page: Pick<Location, "pathname">,
): "newest" | "popular" | "relevance" | "default" | "unknown" {
  if (!CHANNEL_FILTER_PATH.test(page.pathname)) return "unknown";
  const selected = root.querySelectorAll(
    'ytd-browse:not([hidden]) [role="combobox"], ytd-browse:not([hidden]) [role="tab"][aria-selected="true"], ytd-browse:not([hidden]) yt-chip-cloud-chip-renderer[selected]',
  );
  for (const element of selected) {
    const label = (
      element.getAttribute("aria-label") ||
      element.textContent ||
      ""
    ).trim();
    if (/^(人気の動画|再生回数順|Popular|Most popular)$/i.test(label))
      return "popular";
    if (/^(新しい順|Latest|Newest)$/i.test(label)) return "newest";
  }
  // 動画数の少ないチャンネルでは、並び順の欄自体がない。
  // 読み込み途中や未知の選択欄と区別し、空のヘッダーと動画を確認する。
  const grid = root.querySelector(
    "ytd-browse:not([hidden]) ytd-rich-grid-renderer",
  );
  const header = grid?.querySelector("#header");
  if (
    header &&
    header.children.length === 0 &&
    !header.textContent?.trim() &&
    grid?.querySelector(YOUTUBE_SELECTORS.videoCard) &&
    !root.querySelector(
      "ytd-browse:not([hidden]) [role='combobox'], ytd-browse:not([hidden]) yt-chip-cloud-renderer",
    )
  )
    return "default";
  return "unknown";
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
    .map((element) =>
      (element.getAttribute("aria-label") || element.textContent || "").trim(),
    )
    .filter(Boolean);
}

export const youtubeAdapter = Object.freeze({
  id: "youtube",
  matches: Object.freeze(["https://www.youtube.com/*"]),
  settingsKey: "youtube",
  readSortOrder: readYouTubeSortOrder,
  readPageSupport(root: ParentNode, page: Pick<Location, "pathname">) {
    if (!isYouTubeFilterPage(page.pathname)) return "unsupported";
    const sort = readYouTubeSortOrder(root, page);
    if (sort === "popular") return "supported";
    if (sort !== "unknown") return "unsupported";
    const selected = root.querySelectorAll(
      'ytd-browse:not([hidden]) [role="combobox"], ytd-browse:not([hidden]) [role="tab"][aria-selected="true"], ytd-browse:not([hidden]) yt-chip-cloud-chip-renderer[selected]',
    );
    return [...selected].some((e) =>
      /^(古い順|Oldest)$/i.test(
        (e.getAttribute("aria-label") || e.textContent || "").trim(),
      ),
    )
      ? "unsupported"
      : "unknown";
  },
  hasEmptyTimeline(root: ParentNode) {
    return [
      ...root.querySelectorAll("ytd-browse:not([hidden]) ytd-message-renderer"),
    ].some((e) =>
      /^(このチャンネルには動画がありません。?|このチャンネルにはコンテンツがありません。?|このチャンネルには「.*」に一致するコンテンツはありません。?|This channel (?:has no|doesn't have any) (?:videos|content)(?: that matches .*)?\.?)$/i.test(
        e.textContent?.trim() ?? "",
      ),
    );
  },

  readTimelineKey(
    root: ParentNode,
    page: Pick<Location, "pathname" | "search">,
  ) {
    return this.isTimelineAvailable(root, page)
      ? `${page.pathname}${page.search}`
      : null;
  },

  getMetricPostCards(root: ParentNode, limit?: number) {
    return collectMetricCards(
      root,
      (element) =>
        element.matches(YOUTUBE_SELECTORS.videoCard) ? element : null,
      (card) => card.closest(YOUTUBE_SELECTORS.cell) || card,
      100_000,
      limit,
    );
  },

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
      isYouTubeFilterPage(page.pathname) &&
      readYouTubeSortOrder(root, page) === "popular" &&
      this.hasPostCards(root)
    );
  },

  findPostCell(postCard: Element) {
    return postCard.closest(YOUTUBE_SELECTORS.cell) || postCard;
  },

  readPostId(postCard: Element) {
    const href = postCard
      .querySelector(YOUTUBE_SELECTORS.title)
      ?.getAttribute("href");
    if (!href) {
      return null;
    }
    const url = new URL(href, "https://www.youtube.com");
    return url.pathname === "/watch" ? url.searchParams.get("v") : null;
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

  readIsRepost(_postCard: Element) {
    return false;
  },
}) satisfies ServiceAdapter;
