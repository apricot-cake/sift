import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { xAdapter } from "./x.ts";

const like = '<button data-testid="likeBtn" aria-label="12 likes"></button>';
const card = `<div data-testid="feedItem-by-test">${like}</div>`;
const tab = (name: string, selected: boolean, id = "") =>
  `<div role="tab" data-testid="${id}">${name}<div style="${selected ? "background-color: blue" : ""}"></div></div>`;

describe("実機で見つかった表示構造の回帰", () => {
  it.each([
    [0, "投稿", true],
    [1, "返信", false],
    [2, "メディア", true],
    [3, "ビデオ", true],
    [4, "フィード", false],
  ] as const)(
    "プロフィールの %s / %s の対応範囲",
    (index, label, supported) => {
      const root = render(tab(label, true, `profilePager-selector-${index}`));
      expect(
        blueskyAdapter.isTimelineAvailable(root, { pathname: "/profile/test" }),
      ).toBe(supported);
      expect(
        blueskyAdapter.readPageSupport(root, { pathname: "/profile/test" }),
      ).toBe(supported ? "supported" : "unsupported");
    },
  );
  it("検索はURLより選択タブを優先し、URL不変でも最新を判定する", () => {
    const page = { pathname: "/search", search: "?q=test&sort=latest" };
    const root = render(
      `<div data-testid="searchScreen">${tab("トップ", true)}${tab("最新", false)}</div>`,
    );
    expect(blueskyAdapter.isTimelineAvailable(root, page)).toBe(false);
    const tabs = root.querySelectorAll('[role="tab"]');
    tabs[0]?.lastElementChild?.removeAttribute("style");
    tabs[1]?.lastElementChild?.setAttribute("style", "background-color: blue");
    expect(
      blueskyAdapter.isTimelineAvailable(root, { ...page, search: "?q=test" }),
    ).toBe(true);
  });

  it("検索の投稿testidなしカードも1投稿として読む", () => {
    const root = render(
      `<div data-testid="searchScreen"><div role="link"><a href="/profile/test/post/abc">time</a>${like}</div></div>`,
    );
    const posts = blueskyAdapter.getPostCards(root);
    expect(posts).toHaveLength(1);
    if (!posts[0]) throw new Error("投稿がない");
    expect(blueskyAdapter.readPostId(posts[0])).toBe("test:abc");
    expect(blueskyAdapter.readMetricCount(posts[0])).toBe(12);
  });

  it("非選択タブを除き、Sift自身が隠した投稿は再判定する", () => {
    const root = render(
      `<div style="display:none">${card}</div><section>${card}</section>`,
    );
    const active = root.querySelector("section > div") as HTMLElement;
    active.style.display = "none";
    expect(blueskyAdapter.getPostCards(root)).toEqual([active]);
    root.querySelector("section")?.setAttribute("hidden", "");
    expect(blueskyAdapter.getPostCards(root)).toEqual([]);
  });

  it("プロフィールの同一URLでのタブ変更を別一覧として識別する", () => {
    const root = render(
      `${tab("投稿", true, "profilePager-selector-0")}${tab("動画", false, "profilePager-selector-3")}`,
    );
    const page = { pathname: "/profile/test", search: "" };
    const before = blueskyAdapter.readTimelineKey(root, page);
    const tabs = root.querySelectorAll('[role="tab"]');
    tabs[0]?.lastElementChild?.removeAttribute("style");
    tabs[1]?.lastElementChild?.setAttribute("style", "background-color: blue");
    expect(blueskyAdapter.readTimelineKey(root, page)).not.toBe(before);
  });

  it("非選択タブの終端を現在の終端としない", () => {
    const root = render(
      '<div style="display:none"><div data-testid="postsFeed-flatlist"><div dir="auto">End of feed</div></div></div><div data-testid="postsFeed-flatlist"></div>',
    );
    expect(blueskyAdapter.hasReachedTimelineEnd(root)).toBe(false);
  });

  it("プロフィール内のフィードタブは対象にしない", () => {
    expect(
      blueskyAdapter.isTimelineAvailable(
        render(tab("フィード", true, "profilePager-selector-4")),
        { pathname: "/profile/test" },
      ),
    ).toBe(false);
  });

  it.each([
    "video",
    'div data-testid="videoPlayer"',
    'div data-testid="videoComponent"',
  ])("Xの動画枠を画像と判定しない: %s", (video) => {
    const tag = video.split(" ")[0];
    const root = render(
      `<article><div data-testid="tweetPhoto"><${video}></${tag}></div></article>`,
    );
    expect(xAdapter.readMedia(root)).toEqual({
      hasImage: false,
      hasVideo: true,
    });
    root.insertAdjacentHTML(
      "beforeend",
      '<a href="/test/status/1/photo/1"><img></a>',
    );
    expect(xAdapter.readMedia(root)).toEqual({
      hasImage: true,
      hasVideo: true,
    });
  });
});
