// X (x.com / twitter.com). Everything in this file is X's page structure —
// which element is a post, and where each classification input is written. The
// classification itself lives in filter-core.ts and is shared by every service.
import { parseMetric } from "../filter-core.ts";
import { LIKE_THRESHOLDS } from "../settings.ts";
import type { ServiceAdapter } from "./types.ts";

// X's page structure in one place, so a redraw on X's side is one edit here.
// Not exported: what a test supplies is markup, and what it reads is the answer
// this file gives for it (utils/adapters/x.test.ts).
const X_SELECTORS = Object.freeze({
  postCard: 'article[data-testid="tweet"]',
  postCell: '[data-testid="cellInnerDiv"]',
  reactionButton: 'button[data-testid="like"], button[data-testid="unlike"]',
  createdAt: "time[datetime]",
  image: '[data-testid="tweetPhoto"], a[href*="/photo/"]',
  video:
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], video, a[href*="/video/"]',
  socialContext: '[data-testid="socialContext"]'
});

// `satisfies` rather than a `:` annotation, so the literal types Object.freeze
// preserves (`id`, each entry of `matches`) stay literal instead of being
// widened to the interface's `string`/`readonly string[]`.
export const xAdapter = Object.freeze({
  id: "x",
  matches: Object.freeze(["https://x.com/*", "https://twitter.com/*"]),
  // The word this service uses for the reaction the thresholds count.
  reactionLabel: "いいね",
  thresholdKeys: LIKE_THRESHOLDS,

  getPostCards(root: ParentNode) {
    return Array.from(root.querySelectorAll(X_SELECTORS.postCard));
  },

  hasPostCards(root: ParentNode) {
    return Boolean(root.querySelector(X_SELECTORS.postCard));
  },

  // The unit that gets hidden. X wraps every post in a cell that also carries
  // the separator and the surrounding padding, so hiding the card alone would
  // leave a gap behind.
  findPostCell(postCard: Element) {
    return postCard.closest(X_SELECTORS.postCell) || postCard;
  },

  readReactionCount(postCard: Element) {
    const button = postCard.querySelector(X_SELECTORS.reactionButton);
    if (!button) {
      return 0;
    }

    const accessibleText = button.getAttribute("aria-label") || "";
    const visibleText = (button.textContent ?? "").trim();
    return parseMetric(accessibleText || visibleText);
  },

  readCreatedAt(postCard: Element) {
    const dateTime = postCard
      .querySelector(X_SELECTORS.createdAt)
      ?.getAttribute("datetime");
    const timestamp = dateTime ? Date.parse(dateTime) : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  },

  // Image and video are reported separately: which of them counts as media is
  // the reader's setting, not this service's structure.
  readMedia(postCard: Element) {
    return {
      hasImage: Boolean(postCard.querySelector(X_SELECTORS.image)),
      hasVideo: Boolean(postCard.querySelector(X_SELECTORS.video))
    };
  },

  readIsRepost(postCard: Element) {
    const socialContext = postCard.querySelector(X_SELECTORS.socialContext);
    if (!socialContext) {
      return false;
    }

    return /repost|retweeted|リポスト/i.test(socialContext.textContent ?? "");
  }
}) satisfies ServiceAdapter;
