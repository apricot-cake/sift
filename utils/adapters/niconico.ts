import { parseMetric } from "../filter-core.ts";
import type { ServiceAdapter } from "./types.ts";

const WATCH_LINK = 'a[href^="/watch/"]';
const CARD_CANDIDATES =
  "[data-decoration-video-id], [data-video-id], article, li, [class*='VideoItem']";
const VIEW_TEXT = /(?:再生|視聴|views?)/i;
const DATE_TEXT = /\d{4}[/.年-]\d{1,2}[/.月-]\d{1,2}/;
const DURATION_TEXT = /^\d+:\d{2}(?::\d{2})?$/;

function cards(root: ParentNode): Element[] {
  const result = new Set<Element>();
  for (const link of root.querySelectorAll(WATCH_LINK)) {
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
  return (
    pathname.startsWith("/search/") ||
    pathname.startsWith("/tag/") ||
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
  findPostCell(card: Element) {
    return card;
  },
  readPostId(card: Element) {
    return (
      (card.getAttribute("data-decoration-video-id") ||
        card.getAttribute("data-video-id") ||
        /^\/watch\/([^/?#]+)/.exec(
          card.querySelector(WATCH_LINK)?.getAttribute("href") ?? "",
        )?.[1]) ??
      null
    );
  },
  readMetricCount(card: Element) {
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
    const text = texts(card).find((item) => DATE_TEXT.test(item));
    return text === undefined
      ? Number.NaN
      : Date.parse(text.replace(/年|月/g, "/").replace("日", ""));
  },
  readMedia() {
    return { hasImage: false, hasVideo: true };
  },
  readText(card: Element) {
    const links = Array.from(card.querySelectorAll(WATCH_LINK));
    for (const link of links) {
      const text = (
        link.getAttribute("title") ||
        link.textContent ||
        ""
      ).trim();
      if (text && !DURATION_TEXT.test(text)) {
        return text;
      }
    }
    return "";
  },
  readIsRepost() {
    return false;
  },
}) satisfies ServiceAdapter;
