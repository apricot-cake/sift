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

  it("YouTube のチャンネル内検索の再生数と日付を読む", async () => {
    const page = await loadFixture("youtube-channel-search");
    const [post] = youtubeAdapter.getPostCards(page);

    expect(
      youtubeAdapter.isTimelineAvailable(page, { pathname: "/@sift/search" }),
    ).toBe(true);
    expect(post).toBeDefined();
    expect(youtubeAdapter.readPostId?.(post as Element)).toBe("abc123");
    expect(youtubeAdapter.readMetricCount(post as Element)).toBe(14000);
    expect(youtubeAdapter.readCreatedAt(post as Element)).toBeGreaterThan(0);
    expect(youtubeAdapter.readIsMembersOnly?.(post as Element)).toBe(true);
  });

  it("検索語がURLから消えても集計とスクロール位置のキーを分ける", () => {
    const root = render(
      '<ytd-browse><ytd-expandable-tab-renderer><input value="first"></ytd-expandable-tab-renderer><ytd-video-renderer></ytd-video-renderer></ytd-browse>',
    );
    const page = { pathname: "/@example/search", search: "" };
    expect(youtubeAdapter.readPageKey(root, page)).toBe(
      "/@example/search?query=first",
    );
    const input = root.querySelector("input");
    if (!input) throw new Error("検索欄がありません");
    input.value = "second";
    expect(youtubeAdapter.readPageKey(root, page)).toBe(
      "/@example/search?query=second",
    );
    expect(youtubeAdapter.readTimelineKey(root, page)).toBe(
      "/@example/search?query=second",
    );
  });

  it.each([
    "/@example/search",
    "/channel/UC123/search/",
    "/c/example/search",
    "/user/example/search",
  ])("%s は並び順の操作欄がなくても検索結果として対応する", (pathname) => {
    const root = render(
      "<ytd-browse><ytd-video-renderer></ytd-video-renderer></ytd-browse>",
    );
    expect(youtubeAdapter.readSortOrder(root, { pathname })).toBe("relevance");
    expect(youtubeAdapter.readPageSupport(root, { pathname })).toBe(
      "supported",
    );
    expect(youtubeAdapter.isTimelineAvailable(root, { pathname })).toBe(true);
  });

  it("チャンネル内検索の0件表示を読み込み失敗と区別する", () => {
    const root = render(
      "<ytd-browse><ytd-message-renderer>このチャンネルには「nothing」に一致するコンテンツはありません。</ytd-message-renderer></ytd-browse>",
    );
    expect(youtubeAdapter.hasEmptyTimeline(root)).toBe(true);
    expect(
      youtubeAdapter.hasEmptyTimeline(render("<ytd-browse></ytd-browse>")),
    ).toBe(false);
  });

  it.each([
    ["2.6万", 26000],
    ["1.2M", 1200000],
    ["12 日前", Number.NaN],
    ["6:04", Number.NaN],
    ["メンバー限定", Number.NaN],
  ])("検索カードの先頭メタデータ %s を読む", (text, expected) => {
    const root = render(
      `<ytd-video-renderer><div id="metadata-line"><span>${text}</span><span>2週間前</span></div></ytd-video-renderer>`,
    );
    expect(youtubeAdapter.readMetricCount(root)).toBe(expected);
  });

  it("ニコニコ動画の検索に読めるカードがあっても対象外", async () => {
    const page = await loadFixture("niconico-search");
    const [post] = niconicoAdapter.getPostCards(page);

    expect(
      niconicoAdapter.isTimelineAvailable(page, {
        pathname: "/search/music",
        search: "?sort=v&order=d",
      }),
    ).toBe(false);
    expect(post).toBeDefined();
    expect(niconicoAdapter.readPostId?.(post as Element)).toBe("sm456");
    expect(niconicoAdapter.readMetricCount(post as Element)).toBe(79000);
    expect(niconicoAdapter.readCreatedAt?.(post as Element)).toBe(
      Date.parse("2026-08-21T15:00:00.000Z"),
    );
  });
});
