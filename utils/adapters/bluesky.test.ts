import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { LIKE_THRESHOLDS } from "../settings.ts";
import { blueskyAdapter, timestampFromRecordKey } from "./bluesky.ts";
import { xAdapter } from "./x.ts";

const postHref = "/profile/example.bsky.social/post/3mqcze2d6k23e";
const recordKeyTime = Date.parse("2026-07-10T20:46:00.000Z");

const likeButton =
  '<button data-testid="likeBtn" aria-label="いいねする（63,561件のいいね）"><span>6万</span></button>';

// The testid carries the author's handle, so what the adapter matches on is its
// prefix. Feeds, profiles and notifications draw the first form; the post detail
// screen draws the second.
function renderFeed(...posts: string[]): HTMLElement {
  return render(
    posts
      .map((post) => `<div data-testid="feedItem-by-example.bsky.social">${post}</div>`)
      .join("")
  );
}

function renderPost(inner = ""): Element {
  const card = renderFeed(`${likeButton}${inner}`).firstElementChild;
  if (!card) {
    throw new Error("the rendered feed has no post card");
  }
  return card;
}

describe("finding posts", () => {
  it("finds the posts in a feed", () => {
    const feed = renderFeed(likeButton, likeButton);

    expect(blueskyAdapter.getPostCards(feed)).toHaveLength(2);
    expect(blueskyAdapter.hasPostCards(feed)).toBe(true);
  });

  it("finds a post on the detail screen, which draws its own testid", () => {
    const screen = render(
      `<div data-testid="postThreadItem-by-example.bsky.social">${likeButton}</div>`
    );

    expect(blueskyAdapter.getPostCards(screen)).toHaveLength(1);
  });

  // Notification rows reuse the post card's testid. What they do not have is a
  // like button, and that is what keeps them out of the reading.
  it("leaves out the notification rows that reuse the same testid", () => {
    const notifications = renderFeed("<span>liked your post</span>");

    expect(blueskyAdapter.getPostCards(notifications)).toEqual([]);
    expect(blueskyAdapter.hasPostCards(notifications)).toBe(false);
  });

  it("finds none on a screen that lists no posts", () => {
    const page = render("<div>settings</div>");

    expect(blueskyAdapter.getPostCards(page)).toEqual([]);
    expect(blueskyAdapter.hasPostCards(page)).toBe(false);
  });
});

// Unlike X, Bluesky keeps the separator and the padding inside the card, so
// there is no outer cell to reach for.
describe("the unit that gets hidden", () => {
  it("is the card itself", () => {
    const card = renderPost();

    expect(blueskyAdapter.findPostCell(card)).toBe(card);
  });
});

describe("reading the like count", () => {
  // The text next to the button is rounded to "6万", which no threshold can be
  // compared against; the accessible label holds the exact count.
  it("reads the exact count out of the accessible label", () => {
    expect(blueskyAdapter.readReactionCount(renderPost())).toBe(63561);
  });

  it("answers 0 where there is no like button", () => {
    const row = renderFeed("<span>liked your post</span>").firstElementChild;
    if (!row) {
      throw new Error("the rendered feed has no row");
    }

    expect(blueskyAdapter.readReactionCount(row)).toBe(0);
  });
});

describe("reading the post time", () => {
  // Bluesky writes no <time datetime>. What it has is a localized absolute time
  // on the permalink, and the record key in that permalink's path.
  it("reads a label Date.parse understands", () => {
    const card = renderPost(
      `<a href="${postHref}" aria-label="2026-08-01T12:00:00.000Z">1時間前</a>`
    );

    expect(blueskyAdapter.readCreatedAt(card)).toBe(Date.parse("2026-08-01T12:00:00.000Z"));
  });

  // The label Bluesky actually writes is a localized absolute time, which
  // Date.parse rejects — so in practice the record key is what carries the time.
  it("falls back to the record key for a label Date.parse refuses", () => {
    expect(Date.parse("2026年7月10日 20:46")).toBeNaN();
    const card = renderPost(`<a href="${postHref}" aria-label="2026年7月10日 20:46">1時間前</a>`);

    expect(blueskyAdapter.readCreatedAt(card)).toBe(recordKeyTime);
  });

  // The post a detail screen is about has no permalink — it is where the link
  // would point. Its first links are to its own sub-pages, whose labels are
  // actions rather than times, and the record key rides in the middle of the
  // path. The first *readable* link wins, not the first link.
  it("reads the sub-page links the detail screen leads with", () => {
    const card = renderPost(`
      <a href="${postHref}/reposted-by" aria-label="この投稿をリポストする"></a>
      <a href="${postHref}/liked-by" aria-label="この投稿をいいねする"></a>
    `);

    expect(blueskyAdapter.readCreatedAt(card)).toBe(recordKeyTime);
  });

  // A quoting post carries the quoted post's permalink too, after its own.
  it("reads the quoting post's own time, not the quoted post's", () => {
    const card = renderPost(`
      <a href="${postHref}" aria-label="2026年7月10日 20:46"></a>
      <a href="/profile/quoted.bsky.social/post/3ms3mmsbt223e"></a>
    `);

    expect(blueskyAdapter.readCreatedAt(card)).toBe(recordKeyTime);
  });

  // Neither reading available: the post still classifies, only "rising" drops.
  it("answers NaN for a link whose key is not a record key", () => {
    const card = renderPost('<a href="/profile/example.bsky.social/post/self"></a>');

    expect(blueskyAdapter.readCreatedAt(card)).toBeNaN();
  });

  it("answers NaN where the post carries no link at all", () => {
    expect(blueskyAdapter.readCreatedAt(renderPost())).toBeNaN();
  });
});

describe("timestampFromRecordKey", () => {
  it("decodes the key out of a permalink", () => {
    expect(timestampFromRecordKey(postHref)).toBe(recordKeyTime);
    expect(timestampFromRecordKey(`${postHref}?foo=1`)).toBe(recordKeyTime);
    expect(timestampFromRecordKey(`https://bsky.app${postHref}#anchor`)).toBe(recordKeyTime);
  });

  // The key is the segment after /post/, so a link to one of the post's own
  // sub-pages carries it just as well as the permalink does.
  it("decodes the key out of a sub-page link", () => {
    expect(timestampFromRecordKey(`${postHref}/reposted-by`)).toBe(recordKeyTime);
  });

  // A record key is only a TID by convention, so anything that does not decode
  // to a plausible post time is refused: wrong length, a character outside the
  // alphabet, or a time that cannot belong to a post.
  it("refuses anything that is not a plausible post time", () => {
    expect(timestampFromRecordKey("/post/tooshort")).toBeNaN();
    expect(timestampFromRecordKey("/post/3111111111111")).toBeNaN();
    expect(timestampFromRecordKey("")).toBeNaN();
    expect(timestampFromRecordKey(null)).toBeNaN();
    // "aaaaaaaaaaaaa" decodes to the year 2190 — the reason the upper bound
    // exists at all.
    expect(timestampFromRecordKey("/post/aaaaaaaaaaaaa")).toBeNaN();
    // A time before the network existed.
    expect(timestampFromRecordKey("/post/3i5p64yyc222b")).toBeNaN();
  });

  // And a post cannot predate the clock reading it by more than a small skew.
  it("allows a clock that disagrees, and no more", () => {
    expect(timestampFromRecordKey(postHref, recordKeyTime - 3600000)).toBeNaN();
    expect(timestampFromRecordKey(postHref, recordKeyTime - 60000)).toBe(recordKeyTime);
  });
});

describe("reading the media", () => {
  it("reads a post's own image", () => {
    const card = renderPost(
      '<button><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/did/1@jpeg"></button>'
    );

    expect(blueskyAdapter.readMedia(card)).toEqual({ hasImage: true, hasVideo: false });
  });

  // An external link card's thumbnail is served from the same path and is told
  // apart only by what encloses it: a link, not a button.
  it("does not read an external link card's thumbnail as media", () => {
    const card = renderPost(
      '<a href="https://example.com"><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/did/1@jpeg"></a>'
    );

    expect(blueskyAdapter.readMedia(card)).toEqual({ hasImage: false, hasVideo: false });
  });

  // An unplayed video has no <video> at all: the thumbnail is a CSS background.
  it("reads an unplayed video by the background it is drawn with", () => {
    const card = renderPost(
      '<div style="background-image: url(https://video.bsky.app/watch/did/cid/thumbnail.jpg)"></div>'
    );

    expect(blueskyAdapter.readMedia(card)).toEqual({ hasImage: false, hasVideo: true });
  });

  // GIFs come through as an external embed rather than as Bluesky media.
  it("reads a GIF as a video", () => {
    const card = renderPost('<video src="https://t.gifs.bsky.app/gif/1.mp4"></video>');

    expect(blueskyAdapter.readMedia(card)).toEqual({ hasImage: false, hasVideo: true });
  });

  it("reads a post with no media as having none", () => {
    expect(blueskyAdapter.readMedia(renderPost("<span>text only</span>"))).toEqual({
      hasImage: false,
      hasVideo: false
    });
  });
});

// Neither a testid nor a stable word marks a repost: the header reads "◯◯が
// リポスト" in whatever language the reader has. What holds across languages is
// the shape — the repost header's profile link wraps an icon, where an author's
// profile link wraps an avatar image.
describe("reading a repost", () => {
  it("reads a profile link that wraps an icon as the repost header", () => {
    const card = renderPost('<a href="/profile/example.bsky.social"><svg></svg></a>');

    expect(blueskyAdapter.readIsRepost(card)).toBe(true);
  });

  it("does not read an author's link as one, icon or not", () => {
    const card = renderPost(
      '<a href="/profile/example.bsky.social"><svg></svg><img src="/avatar.jpg"></a>'
    );

    expect(blueskyAdapter.readIsRepost(card)).toBe(false);
  });

  it("does not read a profile link wrapping anything else as one", () => {
    const card = renderPost('<a href="/profile/example.bsky.social"><div></div></a>');

    expect(blueskyAdapter.readIsRepost(card)).toBe(false);
  });

  it("does not read an empty profile link as one", () => {
    const card = renderPost('<a href="/profile/example.bsky.social"></a>');

    expect(blueskyAdapter.readIsRepost(card)).toBe(false);
  });

  it("answers false where there is no profile link", () => {
    expect(blueskyAdapter.readIsRepost(renderPost())).toBe(false);
  });
});

// Bluesky's like is X's like, so the threshold and the word are shared rather
// than duplicated per service.
describe("what the thresholds count", () => {
  it("is the same like X counts, against the same pair of numbers", () => {
    expect(blueskyAdapter.reactionLabel).toBe(xAdapter.reactionLabel);
    expect(blueskyAdapter.thresholdKeys).toBe(LIKE_THRESHOLDS);
  });
});
