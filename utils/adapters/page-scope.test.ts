import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { niconicoAdapter } from "./niconico.ts";
import { xAdapter } from "./x.ts";
import { readYouTubeSortOrder, youtubeAdapter } from "./youtube.ts";

const cards = `<article data-testid="tweet"></article>
  <div data-testid="feedItem-by-test"><button data-testid="likeBtn"></button></div>
  <ytd-browse><button role="tab" aria-selected="true">新しい順</button><ytd-video-renderer></ytd-video-renderer></ytd-browse>
  <article data-video-id="sm123"><a href="/watch/sm123">動画</a></article>`;

describe.each(["videos", "shorts", "streams"])("YouTube %s の並び順", (tab) => {
  it("並び順欄のない読み込み済みグリッドは通常表示として扱う", () => {
    const root = render(
      `<ytd-browse><button role="tab" aria-selected="true">動画</button><ytd-rich-grid-renderer><div id="header"></div><ytd-rich-item-renderer><yt-lockup-view-model></yt-lockup-view-model></ytd-rich-item-renderer></ytd-rich-grid-renderer></ytd-browse>`,
    );
    const page = { pathname: `/@example/${tab}` };
    expect(readYouTubeSortOrder(root, page)).toBe("default");
    expect(youtubeAdapter.isTimelineAvailable(root, page)).toBe(true);
  });
  it.each([
    '<div id="header"></div>',
    "<ytd-rich-item-renderer><yt-lockup-view-model></yt-lockup-view-model></ytd-rich-item-renderer>",
    '<div id="header"><button role="combobox">不明</button></div><ytd-rich-item-renderer><yt-lockup-view-model></yt-lockup-view-model></ytd-rich-item-renderer>',
    '<div id="header"><yt-chip-cloud-renderer></yt-chip-cloud-renderer></div><ytd-rich-item-renderer><yt-lockup-view-model></yt-lockup-view-model></ytd-rich-item-renderer>',
  ])("読み込み途中や未知の並び順を通常表示にしない", (html) => {
    const root = render(
      `<ytd-browse><ytd-rich-grid-renderer>${html}</ytd-rich-grid-renderer></ytd-browse>`,
    );
    expect(readYouTubeSortOrder(root, { pathname: `/@example/${tab}` })).toBe(
      "unknown",
    );
  });
  it.each([
    ["新しい順", "newest", true],
    ["人気の動画", "popular", true],
    ["Latest", "newest", true],
    ["Popular", "popular", true],
    ["古い順", "unknown", false],
    ["Oldest", "unknown", false],
  ] as const)("プルダウンの %s を判定する", (label, order, available) => {
    const root = render(`
      <ytd-browse hidden><button role="combobox">新しい順</button></ytd-browse>
      <ytd-browse>
        <button role="tab" aria-selected="true">動画</button>
        <button role="combobox" aria-selected="false"><div>${label}</div></button>
        <button role="tab" aria-selected="false">メンバー限定</button>
        <ytd-video-renderer></ytd-video-renderer>
      </ytd-browse>
    `);
    const page = { pathname: `/@example/${tab}` };
    expect(readYouTubeSortOrder(root, page)).toBe(order);
    expect(youtubeAdapter.isTimelineAvailable(root, page)).toBe(available);
  });
  it.each(["新しい順", "人気の動画", "Latest", "Popular"])(
    "%s は対象",
    (label) => {
      const root = render(
        `<ytd-browse><button role="tab" aria-selected="true">${label}</button><ytd-video-renderer></ytd-video-renderer></ytd-browse>`,
      );
      expect(
        youtubeAdapter.isTimelineAvailable(root, {
          pathname: `/@example/${tab}`,
        }),
      ).toBe(true);
    },
  );
  it.each(["古い順", "Oldest", "", "不明"])(
    "%s はカードが残っていても対象外",
    (label) => {
      const root = render(
        `<ytd-browse><button role="tab" aria-selected="false">新しい順</button><button role="tab" aria-selected="true">${label}</button><ytd-video-renderer></ytd-video-renderer></ytd-browse>`,
      );
      const page = { pathname: `/@example/${tab}`, search: "" };
      expect(youtubeAdapter.isTimelineAvailable(root, page)).toBe(false);
      expect(youtubeAdapter.readTimelineKey(root, page)).toBeNull();
    },
  );
});

describe.each([
  {
    adapter: xAdapter,
    accepted: ["/i/lists/123", "/example", "/search?q=test&f=live"],
    rejected: [
      "/",
      "/home",
      "/search?q=test",
      "/search?q=test&f=top",
      "/search?q=test&f=user",
      "/example/status/123",
      "/example/media?filter=photo",
      "/example/media",
      "/example/media?filter=video",
      "/example/with_replies",
      "/example/likes",
      "/example/highlights",
      "/example/reposts",
      "/notifications",
      "/settings",
      "/explore",
      "/i/lists/123/members",
    ],
  },
  {
    adapter: blueskyAdapter,
    accepted: [
      "/profile/example.test",
      "/profile/example.test/media",
      "/profile/example.test/lists/123",
    ],
    rejected: [
      "/",
      "/search?q=test",
      "/search?q=test&sort=top",
      "/search?q=test&sort=latest",
      "/profile/example.test/feed/123",
      "/profile/example.test/replies",
      "/profile/example.test/post/123",
      "/notifications",
      "/feeds",
      "/profile/example.test/lists",
    ],
  },
  {
    adapter: youtubeAdapter,
    accepted: [
      "/@example/videos",
      "/@example/shorts",
      "/@example/streams",
      "/@example/search?query=test",
    ],
    rejected: [
      "/",
      "/@example",
      "/@example/featured",
      "/results?search_query=test",
      "/feed/subscriptions",
      "/watch?v=test",
      "/@example/live",
    ],
  },
  {
    adapter: niconicoAdapter,
    accepted: [
      "/user/123/video",
      "/user/123/video?sortKey=registeredAt&sortOrder=desc",
      "/user/123/video?sortKey=viewCount&sortOrder=desc",
    ],
    rejected: [
      "/search/test?sort=v&order=d",
      "/tag/test?sort=f&order=d",
      "/user/123/mylist/456?sortKey=viewCount&sortOrder=desc",
      "/user/123/video?sortKey=viewCount&sortOrder=asc",
      "/user/123/video?sortKey=lastCommentTime&sortOrder=desc",
      "/watch/sm123",
    ],
  },
])("$adapter.id の対応範囲", ({ adapter, accepted, rejected }) => {
  it.each(accepted)("%s は対象", (path) => {
    expect(
      adapter.isTimelineAvailable(
        render(cards),
        new URL(path, "https://example.com"),
      ),
    ).toBe(true);
  });
  it.each(rejected)("%s は投稿カードが残っていても対象外", (path) => {
    expect(
      adapter.isTimelineAvailable(
        render(cards),
        new URL(path, "https://example.com"),
      ),
    ).toBe(false);
  });
});
