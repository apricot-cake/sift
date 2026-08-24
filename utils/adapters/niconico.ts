import { parseMetric } from "../filter-core.ts";
import type { ServiceAdapter } from "./types.ts";

const WATCH_LINK = 'a[href^="/watch/"]';
const CARD_CANDIDATES = "article, li, [data-video-id], [class*='VideoItem']";
const VIEW_TEXT = /(?:再生|視聴|views?)/i;
const DATE_TEXT = /\d{4}[/.年-]\d{1,2}[/.月-]\d{1,2}/;

function cards(root: ParentNode): Element[] {
  const result = new Set<Element>();
  for (const link of root.querySelectorAll(WATCH_LINK)) {
    const card = link.closest(CARD_CANDIDATES) || link.parentElement;
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
  return (
    pathname.startsWith("/search/") ||
    pathname.startsWith("/tag/") ||
    pathname === "/newarrival" ||
    /^\/user\/\d+\/(?:video|mylist)/.test(pathname)
  );
}

export const niconicoAdapter = Object.freeze({
  id: "niconico",
  matches: Object.freeze(["https://www.nicovideo.jp/*"]),
  settingsKey: "niconico",
  getPostCards: cards,
  hasPostCards(root: ParentNode) {
    return cards(root).length > 0;
  },
  isTimelineAvailable(root: ParentNode, page: Pick<Location, "pathname">) {
    return isNiconicoFilterPage(page.pathname) && this.hasPostCards(root);
  },
  settingsScope() {
    return null;
  },
  findPostCell(card: Element) {
    return card;
  },
  readPostId(card: Element) {
    return (
      /^\/watch\/([^/?#]+)/.exec(
        card.querySelector(WATCH_LINK)?.getAttribute("href") ?? "",
      )?.[1] ?? null
    );
  },
  readMetricCount(card: Element) {
    const text = texts(card).find((item) => VIEW_TEXT.test(item));
    return text === undefined ? Number.NaN : parseMetric(text);
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
    const text = texts(card).find((item) => DATE_TEXT.test(item));
    return text === undefined
      ? Number.NaN
      : Date.parse(text.replace(/年|月/g, "/").replace("日", ""));
  },
  readMedia() {
    return { hasImage: false, hasVideo: true };
  },
  readText(card: Element) {
    const link = card.querySelector(WATCH_LINK);
    return (link?.getAttribute("title") || link?.textContent || "").trim();
  },
  readIsRepost() {
    return false;
  },
}) satisfies ServiceAdapter;
