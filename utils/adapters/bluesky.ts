// Bluesky (bsky.app). Everything in this file is Bluesky's page structure —
// which element is a post, and where each classification input is written. The
// classification itself lives in filter-core.ts and is shared by every service.
import { parseMetric } from "../filter-core.ts";
import { LIKE_THRESHOLDS } from "../settings.ts";
import type { ServiceAdapter } from "./types.ts";

// Bluesky's page structure in one place, so a redraw on Bluesky's side is one
// edit here. Not exported: what a test supplies is markup, and what it reads is
// the answer this file gives for it (utils/adapters/bluesky.test.ts).
const BLUESKY_SELECTORS = Object.freeze({
  // The testid carries the author's handle ("feedItem-by-bsky.app"), so these
  // are prefix matches. Feeds, profiles and notifications use the first form;
  // the post detail screen uses the second.
  postCard:
    '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]',
  reactionButton: '[data-testid="likeBtn"]',
  postLink: 'a[href*="/post/"]',
  // Under a button, which is what separates a post's own image from the
  // thumbnail of an external link card — that one sits under an <a>.
  image: 'button img[src*="/img/feed_thumbnail/"]',
  // An unplayed video has no <video> element at all: the thumbnail is drawn as
  // a CSS background image. A <video> only appears once playback starts.
  video: '[style*="video.bsky.app"]',
  // GIFs come through as an external embed rather than as Bluesky media.
  animatedImage: 'video[src*="t.gifs.bsky.app"]',
  profileLink: 'a[href^="/profile/"]'
});

// AT Protocol record keys are TIDs: 13 characters of base32-sortable holding a
// 64-bit value whose top 53 bits are a microsecond timestamp and whose bottom
// 10 are a clock id.
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const TID_LENGTH = 13;
const TID_CLOCK_ID_BITS = 10n;
// The record key is the segment after /post/, not the last one: on the post
// detail screen the only links carrying it are the ones to that post's own
// sub-pages ("/reposted-by", "/quotes", "/liked-by").
const RECORD_KEY_IN_PATH = /\/post\/([^/?#]+)/;
// Nothing on Bluesky predates the network itself, and nothing was posted after
// now. A record key that is not a TID but happens to be spelled with these
// characters decodes to a value outside that window, which is what makes it
// detectable at all — the lower bound alone does not catch it ("aaaaaaaaaaaaa"
// decodes to the year 2190).
const EARLIEST_PLAUSIBLE_MS = Date.parse("2022-01-01T00:00:00.000Z");
// Enough for a clock that disagrees with the server's, and no more. The same
// allowance classifyPost makes for a post that reads as slightly in the future.
const FUTURE_TOLERANCE_MS = 6 * 60 * 1000;

// The fallback for a post whose displayed timestamp cannot be read. Exported so
// the decoding is tested on its own rather than only through a fake post.
//
// Being a TID is a convention of the official client, not a guarantee of the
// protocol, so this stays the fallback and never the primary reading.
export function timestampFromRecordKey(href: unknown, nowMs = Date.now()): number {
  const recordKey = RECORD_KEY_IN_PATH.exec(String(href ?? ""))?.[1] ?? "";

  if (recordKey.length !== TID_LENGTH) {
    return Number.NaN;
  }

  let bits = 0n;
  for (const character of recordKey) {
    const value = TID_ALPHABET.indexOf(character);
    if (value < 0) {
      return Number.NaN;
    }
    bits = (bits << 5n) | BigInt(value);
  }

  const milliseconds = Number((bits >> TID_CLOCK_ID_BITS) / 1000n);
  const plausible =
    milliseconds >= EARLIEST_PLAUSIBLE_MS &&
    milliseconds <= nowMs + FUTURE_TOLERANCE_MS;
  return plausible ? milliseconds : Number.NaN;
}

// Notifications reuse the post card's testid for rows that are not posts — a
// like, a follow. Those rows carry no like button, which is the one part of a
// post every post has and no notification row does.
function readablePostCards(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(BLUESKY_SELECTORS.postCard)).filter(
    (postCard) => postCard.querySelector(BLUESKY_SELECTORS.reactionButton)
  );
}

// `satisfies` rather than a `:` annotation — see x.ts for why.
export const blueskyAdapter = Object.freeze({
  id: "bluesky",
  matches: Object.freeze(["https://bsky.app/*"]),
  // The word this service uses for the reaction the thresholds count. Same
  // reaction as X's, so the two share the thresholds as well.
  reactionLabel: "いいね",
  thresholdKeys: LIKE_THRESHOLDS,

  getPostCards(root: ParentNode) {
    return readablePostCards(root);
  },

  hasPostCards(root: ParentNode) {
    return readablePostCards(root).length > 0;
  },

  // The unit that gets hidden. Unlike X, Bluesky keeps the separator and the
  // padding inside the card, so there is no outer cell to reach for.
  findPostCell(postCard: Element) {
    return postCard;
  },

  readReactionCount(postCard: Element) {
    const button = postCard.querySelector(BLUESKY_SELECTORS.reactionButton);
    if (!button) {
      return 0;
    }

    // The accessible label holds the exact count; the visible text next to the
    // button is rounded ("6万"), which no threshold can be compared against.
    return parseMetric(button.getAttribute("aria-label") || "");
  },

  // Bluesky writes no <time datetime>. What it has is a localized absolute time
  // on the permalink, which Date.parse accepts for some locales and not others,
  // and the record key, which is machine-readable but only a convention.
  //
  // The first readable link wins rather than the first link: a post in a feed
  // leads with its own permalink, but the post a detail screen is *about* has
  // no permalink at all — being where the link would point — and leads with the
  // links to its own sub-pages instead.
  readCreatedAt(postCard: Element) {
    for (const link of postCard.querySelectorAll(BLUESKY_SELECTORS.postLink)) {
      const label = link.getAttribute("aria-label");
      const displayed = label ? Date.parse(label) : Number.NaN;
      if (Number.isFinite(displayed)) {
        return displayed;
      }

      const decoded = timestampFromRecordKey(link.getAttribute("href"));
      if (Number.isFinite(decoded)) {
        return decoded;
      }
    }

    return Number.NaN;
  },

  // Image and video are reported separately: which of them counts as media is
  // the reader's setting, not this service's structure.
  readMedia(postCard: Element) {
    return {
      hasImage: Boolean(postCard.querySelector(BLUESKY_SELECTORS.image)),
      hasVideo: Boolean(
        postCard.querySelector(BLUESKY_SELECTORS.video) ||
          postCard.querySelector(BLUESKY_SELECTORS.animatedImage)
      )
    };
  },

  // Neither a testid nor a stable word marks a repost: the header reads
  // "◯◯がリポスト" in whatever language the reader has. What does hold across
  // languages is the shape — the repost header's profile link wraps an icon,
  // where an author's profile link wraps an avatar image.
  readIsRepost(postCard: Element) {
    const profileLink = postCard.querySelector(BLUESKY_SELECTORS.profileLink);
    if (!profileLink || profileLink.querySelector("img")) {
      return false;
    }

    const firstChild = profileLink.firstElementChild;
    return firstChild?.tagName?.toLowerCase() === "svg";
  }
}) satisfies ServiceAdapter;
