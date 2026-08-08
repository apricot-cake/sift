import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { LIKE_THRESHOLDS } from "../settings.ts";
import { xAdapter } from "./x.ts";

// X wraps every post in a cell that also carries the separator and the padding
// around it, and the post itself is the article inside that cell.
function renderTimeline(...posts: string[]): HTMLElement {
  return render(
    posts
      .map(
        (post) =>
          `<div data-testid="cellInnerDiv"><article data-testid="tweet">${post}</article></div>`
      )
      .join("")
  );
}

function renderPost(inner = ""): Element {
  const card = renderTimeline(inner).querySelector("article");
  if (!card) {
    throw new Error("the rendered timeline has no post card");
  }
  return card;
}

describe("finding posts", () => {
  it("finds every post on the screen", () => {
    const timeline = renderTimeline("<span>first</span>", "<span>second</span>");

    expect(xAdapter.getPostCards(timeline)).toHaveLength(2);
    expect(xAdapter.hasPostCards(timeline)).toBe(true);
  });

  it("finds none on a screen that lists no posts", () => {
    const page = render('<div data-testid="primaryColumn">settings</div>');

    expect(xAdapter.getPostCards(page)).toEqual([]);
    expect(xAdapter.hasPostCards(page)).toBe(false);
  });
});

describe("the unit that gets hidden", () => {
  it("is the cell around the post, so hiding leaves no gap behind", () => {
    const timeline = renderTimeline("");
    const cell = timeline.firstElementChild;
    const card = cell?.firstElementChild;
    if (!cell || !card) {
      throw new Error("the rendered timeline has no cell");
    }

    expect(xAdapter.findPostCell(card)).toBe(cell);
  });

  it("falls back to the post itself where there is no cell", () => {
    const card = render('<article data-testid="tweet"></article>').firstElementChild;
    if (!card) {
      throw new Error("the rendered post has no card");
    }

    expect(xAdapter.findPostCell(card)).toBe(card);
  });
});

describe("reading the like count", () => {
  // The visible text is rounded to "1.1万" and could never be compared against
  // a threshold; the accessible label carries the exact number.
  it("prefers the accessible label over the rounded text next to it", () => {
    const card = renderPost(
      '<button data-testid="like" aria-label="11788 件のいいね。いいねする"><span>1.1万</span></button>'
    );

    expect(xAdapter.readReactionCount(card)).toBe(11788);
  });

  it("falls back to the visible text when the button carries no label", () => {
    const card = renderPost('<button data-testid="like"> 1,234 </button>');

    expect(xAdapter.readReactionCount(card)).toBe(1234);
  });

  // A post the reader has already liked carries the other testid, and it is the
  // same count.
  it("reads a post the reader already liked", () => {
    const card = renderPost(
      '<button data-testid="unlike" aria-label="1,234 件のいいね。いいねを取り消す"></button>'
    );

    expect(xAdapter.readReactionCount(card)).toBe(1234);
  });

  it("answers 0 where there is no like button at all", () => {
    expect(xAdapter.readReactionCount(renderPost())).toBe(0);
  });
});

describe("reading the post time", () => {
  it("reads the machine-readable time X writes", () => {
    const card = renderPost(
      '<a href="/example/status/1"><time datetime="2026-08-01T12:00:00.000Z">8月1日</time></a>'
    );

    expect(xAdapter.readCreatedAt(card)).toBe(Date.parse("2026-08-01T12:00:00.000Z"));
  });

  // Neither reading available: the post still classifies, only "rising" drops.
  it("answers NaN where there is no time", () => {
    expect(xAdapter.readCreatedAt(renderPost())).toBeNaN();
  });

  it("answers NaN for a time it cannot parse", () => {
    const card = renderPost('<time datetime="not a date">8月1日</time>');

    expect(xAdapter.readCreatedAt(card)).toBeNaN();
  });
});

// Image and video stay separate: folding them into one answer is the reader's
// media setting, which is not this adapter's to apply.
describe("reading the media", () => {
  it("reads an attached photo", () => {
    const card = renderPost('<div data-testid="tweetPhoto"><img src="/media/1.jpg"></div>');

    expect(xAdapter.readMedia(card)).toEqual({ hasImage: true, hasVideo: false });
  });

  // A post whose photo is drawn as a link rather than as the testid'd container
  // — the form the detail screen uses.
  it("reads a photo behind its permalink", () => {
    const card = renderPost('<a href="/example/status/1/photo/1"><img src="/media/1.jpg"></a>');

    expect(xAdapter.readMedia(card)).toEqual({ hasImage: true, hasVideo: false });
  });

  it("reads a video", () => {
    const card = renderPost('<div data-testid="videoPlayer"><video></video></div>');

    expect(xAdapter.readMedia(card)).toEqual({ hasImage: false, hasVideo: true });
  });

  it("reads a post with no media as having none", () => {
    expect(xAdapter.readMedia(renderPost("<span>text only</span>"))).toEqual({
      hasImage: false,
      hasVideo: false
    });
  });
});

describe("reading a repost", () => {
  it("reads the repost header X draws above the post", () => {
    const card = renderPost(
      '<div data-testid="socialContext">さんがリポストしました</div>'
    );

    expect(xAdapter.readIsRepost(card)).toBe(true);
  });

  // The same header carries other words: being pinned is not being reposted.
  it("does not read a pinned post as a repost", () => {
    const card = renderPost('<div data-testid="socialContext">固定されたポスト</div>');

    expect(xAdapter.readIsRepost(card)).toBe(false);
  });

  it("answers false where there is no header", () => {
    expect(xAdapter.readIsRepost(renderPost())).toBe(false);
  });
});

// The toolbar and its settings panel take this word from the adapter rather
// than spelling out X's.
describe("what the thresholds count", () => {
  it("is the like, under X's own word for it", () => {
    expect(xAdapter.reactionLabel).toBe("いいね");
    expect(xAdapter.thresholdKeys).toBe(LIKE_THRESHOLDS);
  });
});
