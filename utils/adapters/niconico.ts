import { collectMetricCards } from "./metric-cards.ts";
import type { ServiceAdapter } from "./types.ts";

const WATCH_LINK = 'a[href*="/watch/"]';
const CARD_CANDIDATES =
  "[data-decoration-video-id], [data-video-id], .NC-VideoMediaObject, article, li, [class*='VideoItem']";
const SEARCH_CARD =
  '[data-decoration-video-id][data-anchor-page="search"][data-anchor-area="main"]';

function isSearchRoot(root: ParentNode): boolean {
  return (
    root.querySelector('[data-anchor-page="search"]') !== null ||
    /^\/search\/[^/]+\/?$/.test(
      (root.ownerDocument ?? (root as Document)).location?.pathname ?? "",
    )
  );
}

function cardForLink(link: Element, search: boolean): Element | null {
  return link.matches(WATCH_LINK) && videoId(link) !== null
    ? link.closest(search ? SEARCH_CARD : CARD_CANDIDATES)
    : null;
}

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
  const search = isSearchRoot(root);
  for (const link of root.querySelectorAll(WATCH_LINK)) {
    const card = cardForLink(link, search);
    if (card) {
      result.add(card);
    }
  }
  return [...result];
}

export function isNiconicoFilterPage(pathname: string): boolean {
  return (
    /^\/user\/\d+\/video\/?$/.test(pathname) ||
    /^\/search\/[^/]+\/?$/.test(pathname)
  );
}

export function isNiconicoSupportedSort(
  _root: ParentNode,
  page: Pick<Location, "pathname"> & Partial<Pick<Location, "search">>,
): boolean {
  const params = new URLSearchParams(page.search ?? "");
  if (/^\/user\/\d+\/video\/?$/.test(page.pathname)) {
    const key = params.get("sortKey");
    const order = params.get("sortOrder") ?? "desc";
    return order === "desc" && key === "viewCount";
  }
  if (/^\/search\/[^/]+\/?$/.test(page.pathname)) {
    return (
      (params.get("order") === "desc" && params.get("sort") === "viewCount") ||
      (params.get("order") === "d" && params.get("sort") === "v")
    );
  }
  return false;
}

export const niconicoAdapter = Object.freeze({
  id: "niconico",
  matches: Object.freeze(["https://www.nicovideo.jp/*"]),
  settingsKey: "niconico",
  readSortOrder(root: ParentNode, page: Pick<Location, "pathname" | "search">) {
    if (!isNiconicoSupportedSort(root, page)) return "unknown";
    return "popular";
  },
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
  getMetricPostCards(root: ParentNode, limit?: number) {
    const search = isSearchRoot(root);
    return collectMetricCards(
      root,
      (element) => cardForLink(element, search),
      undefined,
      100_000,
      limit,
    );
  },

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
    const text = card.querySelector(
      ".NC-VideoRegisteredAtText-text",
    )?.textContent;
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
