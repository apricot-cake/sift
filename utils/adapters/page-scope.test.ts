import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { xAdapter } from "./x.ts";

const cards = `<article data-testid="tweet"></article>
  <div data-testid="feedItem-by-test"><button data-testid="likeBtn"></button></div>`;

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
      "/profile/example.test/feed/123",
    ],
    rejected: [
      "/",
      "/search?q=test",
      "/search?q=test&sort=top",
      "/search?q=test&sort=latest",
      "/profile/example.test/replies",
      "/profile/example.test/post/123",
      "/notifications",
      "/feeds",
      "/profile/example.test/lists",
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
