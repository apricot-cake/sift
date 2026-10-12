import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { niconicoAdapter } from "./niconico.ts";
import { xAdapter } from "./x.ts";
import { youtubeAdapter } from "./youtube.ts";

async function loadFixture(name: string): Promise<HTMLElement> {
  const html = await readFile(
    path.join(process.cwd(), "test", "fixtures", "adapters", `${name}.html`),
    "utf8",
  );
  return render(html);
}

describe("対応サイトの HTML fixture", () => {
  it("Xの検索結果0件を構造取得失敗と区別する", async () => {
    const page = await loadFixture("x-empty-search");
    expect(xAdapter.hasEmptyTimeline(page)).toBe(true);
    expect(xAdapter.getPostCards(page)).toHaveLength(0);
    const marker = page.querySelector('[data-testid="emptyState"]');
    marker?.removeAttribute("data-testid");
    expect(xAdapter.hasEmptyTimeline(page)).toBe(false);
  });
  it("X のフォロー中タイムラインを読む", async () => {
    const page = await loadFixture("x-following");
    const [post] = xAdapter.getPostCards(page);

    expect(xAdapter.isTimelineAvailable(page, { pathname: "/home" })).toBe(
      true,
    );
    expect(post).toBeDefined();
    expect(xAdapter.readPostId?.(post as Element)).toBe("123456789");
    expect(xAdapter.readMetricCount(post as Element)).toBe(11788);
    expect(xAdapter.readMedia(post as Element)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  it("Bluesky のホームフィードを読む", async () => {
    const page = await loadFixture("bluesky-home");
    const [post] = blueskyAdapter.getPostCards(page);

    expect(blueskyAdapter.isTimelineAvailable(page, { pathname: "/" })).toBe(
      true,
    );
    expect(post).toBeDefined();
    expect(blueskyAdapter.readPostId?.(post as Element)).toBe(
      "example.bsky.social:3mqcze2d6k23e",
    );
    expect(blueskyAdapter.readMetricCount(post as Element)).toBe(63561);
    expect(blueskyAdapter.readMedia(post as Element)).toEqual({
      hasImage: true,
      hasVideo: false,
    });
  });

  it("YouTube の再生数順動画の投稿日時を読む", async () => {
    const page = await loadFixture("youtube-videos-popular");
    const [post] = youtubeAdapter.getPostCards(page);
    expect(
      youtubeAdapter.isTimelineAvailable(page, { pathname: "/@sift/videos" }),
    ).toBe(true);
    expect(post).toBeDefined();
    expect(youtubeAdapter.readPostId(post as Element)).toBe("abc123");
    expect(youtubeAdapter.readCreatedAt(post as Element)).toBeGreaterThan(0);
  });
  it.each([
    "/@example/search",
    "/channel/UC123/search/",
    "/c/example/search",
    "/user/example/search",
  ])("%s はカードが残っていても対象にしない", (pathname) => {
    const root = render(
      "<ytd-browse><ytd-video-renderer></ytd-video-renderer></ytd-browse>",
    );
    expect(youtubeAdapter.readPageSupport(root, { pathname })).toBe(
      "unsupported",
    );
    expect(youtubeAdapter.isTimelineAvailable(root, { pathname })).toBe(false);
    expect(
      youtubeAdapter.readTimelineKey(root, { pathname, search: "" }),
    ).toBeNull();
  });
  it("ニコニコ動画の再生数順検索のカードを読む", async () => {
    const page = await loadFixture("niconico-search");
    const [post] = niconicoAdapter.getPostCards(page);

    expect(
      niconicoAdapter.isTimelineAvailable(page, {
        pathname: "/search/music",
        search: "?sort=v&order=d",
      }),
    ).toBe(true);
    expect(post).toBeDefined();
    expect(niconicoAdapter.readPostId?.(post as Element)).toBe("sm456");
    expect(niconicoAdapter.readCreatedAt?.(post as Element)).toBe(
      Date.parse("2026-08-21T15:00:00.000Z"),
    );
  });
});
