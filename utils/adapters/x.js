// X (x.com / twitter.com). Everything in this file is X's page structure —
// which element is a post, and where each classification input is written. The
// classification itself lives in filter-core.js and is shared by every service.
import { parseMetric } from "../filter-core.js";

// Named so a test can build a fake node keyed by the same selectors the adapter
// asks for, without restating them.
export const X_SELECTORS = Object.freeze({
  postCard: 'article[data-testid="tweet"]',
  postCell: '[data-testid="cellInnerDiv"]',
  reactionButton: 'button[data-testid="like"], button[data-testid="unlike"]',
  createdAt: "time[datetime]",
  image: '[data-testid="tweetPhoto"], a[href*="/photo/"]',
  video:
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], video, a[href*="/video/"]',
  socialContext: '[data-testid="socialContext"]'
});

export const xAdapter = Object.freeze({
  id: "x",
  matches: Object.freeze(["https://x.com/*", "https://twitter.com/*"]),
  // The word this service uses for the reaction the thresholds count.
  reactionLabel: "いいね",

  getPostCards(root) {
    return Array.from(root.querySelectorAll(X_SELECTORS.postCard));
  },

  hasPostCards(root) {
    return Boolean(root.querySelector(X_SELECTORS.postCard));
  },

  // The unit that gets hidden. X wraps every post in a cell that also carries
  // the separator and the surrounding padding, so hiding the card alone would
  // leave a gap behind.
  findPostCell(postCard) {
    return postCard.closest(X_SELECTORS.postCell) || postCard;
  },

  readReactionCount(postCard) {
    const button = postCard.querySelector(X_SELECTORS.reactionButton);
    if (!button) {
      return 0;
    }

    const accessibleText = button.getAttribute("aria-label") || "";
    const visibleText = button.textContent.trim();
    return parseMetric(accessibleText || visibleText);
  },

  readCreatedAt(postCard) {
    const dateTime = postCard
      .querySelector(X_SELECTORS.createdAt)
      ?.getAttribute("datetime");
    const timestamp = dateTime ? Date.parse(dateTime) : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  },

  // Image and video are reported separately: which of them counts as media is
  // the reader's setting, not this service's structure.
  readMedia(postCard) {
    return {
      hasImage: Boolean(postCard.querySelector(X_SELECTORS.image)),
      hasVideo: Boolean(postCard.querySelector(X_SELECTORS.video))
    };
  },

  readIsRepost(postCard) {
    const socialContext = postCard.querySelector(X_SELECTORS.socialContext);
    if (!socialContext) {
      return false;
    }

    return /repost|retweeted|リポスト/i.test(socialContext.textContent);
  }
});
