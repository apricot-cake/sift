import { parseMetric } from "../filter-core.ts";
import type { ServiceAdapter } from "./types.ts";

const CARD = ".searchItem, .soundList__item, .streamItem";
const TITLE = ".soundTitle__title[href]";

function trackCards(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(CARD)).filter(
    (card) => card.querySelector(".sound") && card.querySelector(TITLE),
  );
}

export function isSoundCloudFilterPage(pathname: string): boolean {
  return (
    pathname === "/search/sounds" ||
    pathname === "/feed" ||
    /^\/[^/]+\/tracks\/?$/.test(pathname)
  );
}

export const soundcloudAdapter = Object.freeze({
  id: "soundcloud",
  matches: Object.freeze(["https://soundcloud.com/*"]),
  settingsKey: "soundcloud",
  getPostCards: trackCards,
  hasPostCards(root: ParentNode) {
    return trackCards(root).length > 0;
  },
  isTimelineAvailable(root: ParentNode, page: Pick<Location, "pathname">) {
    return isSoundCloudFilterPage(page.pathname) && this.hasPostCards(root);
  },
  settingsScope() {
    return null;
  },
  findPostCell(card: Element) {
    return card;
  },
  readPostId(card: Element) {
    return card.querySelector(TITLE)?.getAttribute("href") ?? null;
  },
  readMetricCount(card: Element) {
    const plays = card.querySelector(".sc-ministats-plays");
    const text =
      plays?.closest("[title]")?.getAttribute("title") ?? plays?.textContent;
    return text ? parseMetric(text) : Number.NaN;
  },
  readCreatedAt(card: Element) {
    const value = card
      .querySelector("time[datetime]")
      ?.getAttribute("datetime");
    return value ? Date.parse(value) : Number.NaN;
  },
  readMedia() {
    return { hasImage: false, hasVideo: false };
  },
  readText(card: Element) {
    return (card.querySelector(TITLE)?.textContent ?? "").trim();
  },
  readIsRepost() {
    return false;
  },
}) satisfies ServiceAdapter;
