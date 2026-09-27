import { parseMetric } from "../filter-core.ts";
import type { ServiceAdapter } from "./types.ts";

const WATCH_LINK = 'a[href*="/watch/"]';
const CARD_CANDIDATES =
  "[data-decoration-video-id], [data-video-id], .NC-VideoMediaObject, article, li, [class*='VideoItem']";
const VIEW_TEXT = /(?:再生|視聴|views?)/i;
const DATE_TEXT = /\d{4}[/.年-]\d{1,2}[/.月-]\d{1,2}/;

function videoId(link: Element): string | null {
  try {
    const url = new URL(
      link.getAttribute("href") ?? "",
      "https://www.nicovideo.jp",
    );
    if (url.protocol !== "https:" || url.hostname !== "www.nicovideo.jp") {
      return null;
    }
    return /^\/watch\/([a-z]*\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function cards(root: ParentNode): Element[] {
  const result = new Set<Element>();
  for (const link of root.querySelectorAll(WATCH_LINK)) {
    if (videoId(link) === null) continue;
    const card = link.closest(CARD_CANDIDATES);
    if (card) {
      result.add(card);
    }
  }
  return [...result];
}

function texts(card: Element): string[] {
  return Array.from(card.querySelectorAll("span, small, time, [title]"))
    .map((item) =>
      `${item.getAttribute("title") ?? ""} ${item.textContent ?? ""}`.trim(),
    )
    .filter(Boolean);
}

export function isNiconicoFilterPage(pathname: string): boolean {
  return /^\/user\/\d+\/video\/?$/.test(pathname);
}

export function isNiconicoSupportedSort(
  _root: ParentNode,
  page: Pick<Location, "pathname"> & Partial<Pick<Location, "search">>,
): boolean {
  const params = new URLSearchParams(page.search ?? "");
  if (/^\/user\/\d+\/video\/?$/.test(page.pathname)) {
    const key = params.get("sortKey") ?? "registeredAt";
    const order = params.get("sortOrder") ?? "desc";
    return order === "desc" && (key === "registeredAt" || key === "viewCount");
  }
  return false;
}

export const niconicoAdapter = Object.freeze({
  id: "niconico",
  matches: Object.freeze(["https://www.nicovideo.jp/*"]),
  settingsKey: "niconico",
  readPageSupport(
    root: ParentNode,
    page: Pick<Location, "pathname"> & Partial<Pick<Location, "search">>,
  ) {
    return this.isTimelineAvailable(root, page) ? "supported" : "unsupported";
  },
  hasEmptyTimeline(root: ParentNode) {
    return [...root.querySelectorAll('main p, [role="main"] p')].some((e) =>
      /^(投稿動画はありません|動画がありません|投稿された動画はありません)[。！]?$/.test(
        e.textContent?.trim() ?? "",
      ),
    );
  },
  getPostCards: cards,
  hasPostCards(root: ParentNode) {
    return cards(root).length > 0;
  },
  isTimelineAvailable(
    root: ParentNode,
    page: Pick<Location, "pathname"> & Partial<Pick<Location, "search">>,
  ) {
    return (
      isNiconicoFilterPage(page.pathname) && isNiconicoSupportedSort(root, page)
    );
  },
  findPostCell(card: Element) {
    return card;
  },
  readPostId(card: Element) {
    return (
      (card.getAttribute("data-decoration-video-id") ||
        card.getAttribute("data-video-id") ||
        Array.from(card.querySelectorAll(WATCH_LINK))
          .map(videoId)
          .find((id) => id !== null)) ??
      null
    );
  },
  readMetricCount(card: Element) {
    const views = card.querySelector(".NC-VideoMetaCount_view");
    if (views) return parseMetric(views.textContent ?? "");
    const text = texts(card).find((item) => VIEW_TEXT.test(item));
    if (text !== undefined) {
      return parseMetric(text);
    }
    const metadata = card.querySelector("time[datetime]")?.parentElement;
    const firstMetric = metadata?.querySelector("p span")?.textContent;
    return firstMetric ? parseMetric(firstMetric) : Number.NaN;
  },
  readCreatedAt(card: Element) {
    const datetime = card
      .querySelector("time[datetime]")
      ?.getAttribute("datetime");
    if (datetime) {
      const parsed = Date.parse(datetime);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    const text =
      card.querySelector(".NC-VideoRegisteredAtText-text")?.textContent ??
      texts(card).find((item) => DATE_TEXT.test(item));
    return text === undefined
      ? Number.NaN
      : Date.parse(text.replace(/年|月/g, "/").replace("日", ""));
  },
  readMedia() {
    return { hasImage: false, hasVideo: true };
  },
  readIsRepost() {
    return false;
  },
}) satisfies ServiceAdapter;
