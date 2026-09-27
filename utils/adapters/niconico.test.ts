import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { isNiconicoFilterPage, niconicoAdapter } from "./niconico.ts";

describe("ニコニコ動画", () => {
  it.each([
    ["?sortKey=registeredAt&sortOrder=desc", false],
    ["?sortKey=viewCount&sortOrder=desc", false],
    ["?sortKey=registeredAt&sortOrder=asc", false],
    ["?sortKey=viewCount&sortOrder=asc", false],
    ["?sortKey=addedAt&sortOrder=desc", false],
    ["?sortKey=likeCount&sortOrder=desc", false],
    ["?sortKey=viewCount", false],
  ])("個別マイリストの並び順 %s の対応判定", (search, expected) => {
    const root = render(
      '<div class="SortSelectbox-wrapper"><span class="Selectbox-label">再生数が多い順</span></div>',
    );
    expect(
      niconicoAdapter.isTimelineAvailable(root, {
        pathname: "/user/123/mylist/456",
        search,
      }),
    ).toBe(expected);
  });

  it("マイリストは並び順にかかわらず対象外", () => {
    for (const [label, expected] of [
      ["投稿日時が新しい順", false],
      ["再生数が多い順", false],
      ["マイリスト登録が新しい順", false],
    ] as const) {
      const root = render(
        `<div class="SortSelectbox-wrapper"><span class="Selectbox-label">${label}</span></div>`,
      );
      expect(
        niconicoAdapter.isTimelineAvailable(root, {
          pathname: "/user/123/mylist/456",
        }),
      ).toBe(expected);
      expect(
        niconicoAdapter.isTimelineAvailable(root, {
          pathname: "/user/123/mylist",
        }),
      ).toBe(false);
    }
    expect(
      niconicoAdapter.isTimelineAvailable(render(""), {
        pathname: "/user/123/mylist/456",
      }),
    ).toBe(false);
  });
  it.each([
    ["", true],
    ["?sortKey=registeredAt&sortOrder=desc", true],
    ["?sortKey=viewCount&sortOrder=desc", true],
    ["?sortKey=registeredAt&sortOrder=asc", false],
    ["?sortKey=viewCount&sortOrder=asc", false],
    ["?sortKey=lastCommentTime&sortOrder=desc", false],
    ["?sortKey=likeCount&sortOrder=desc", false],
    ["?sortKey=unknown&sortOrder=desc", false],
  ])("投稿一覧の並び順 %s の対応判定", (search, expected) => {
    expect(
      niconicoAdapter.isTimelineAvailable(render(""), {
        pathname: "/user/123/video",
        search,
      }),
    ).toBe(expected);
  });
  it("投稿一覧の完全URLと専用メタデータを読む", () => {
    const page = render(`
      <div class="NC-VideoMediaObject">
        <a href="https://www.nicovideo.jp/watch/sm46562085?ref=list">
          <h2>再生数100万を目指す動画</h2>
          <span class="NC-VideoRegisteredAtText-text">2026/7/18 16:53</span>
          <div class="NC-VideoMetaCount_view">531</div>
          <div class="NC-VideoMetaCount_like">67</div>
        </a>
        <a href="//www.nicovideo.jp/watch/sm46562085">別リンク</a>
      </div>
      <article><a href="https://example.com/watch/sm123">外部リンク</a></article>
      <a href="https://www.nicovideo.jp/watch/sm46562085">連続再生</a>
    `);
    const cards = niconicoAdapter.getPostCards(page);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    if (!card) throw new Error("動画カードが無い");
    expect(niconicoAdapter.readPostId(card)).toBe("sm46562085");
    expect(niconicoAdapter.readMetricCount(card)).toBe(531);
    expect(niconicoAdapter.readCreatedAt(card)).toBe(
      Date.parse("2026/7/18 16:53"),
    );
  });

  it("読み込み中や0件でも対応ページとして扱う", () => {
    expect(
      niconicoAdapter.isTimelineAvailable(render(""), {
        pathname: "/user/123/video",
      }),
    ).toBe(true);
    expect(
      niconicoAdapter.isTimelineAvailable(render(""), {
        pathname: "/watch/sm123",
      }),
    ).toBe(false);
    expect(isNiconicoFilterPage("/user/123/videos-other")).toBe(false);
  });
  it("一覧カードの動画ID、再生数、公開時刻、タイトルを読む", () => {
    const card = render(`
      <article data-video-id="sm123">
        <a href="/watch/sm123" title="動画タイトル">動画タイトル</a>
        <span title="1.2万 再生">1.2万</span>
        <time datetime="2026-08-23T12:00:00+09:00"></time>
      </article>
    `).firstElementChild;
    if (!card) throw new Error("動画カードが無い");

    expect(niconicoAdapter.readPostId?.(card)).toBe("sm123");
    expect(niconicoAdapter.readMetricCount(card)).toBe(12000);
    expect(niconicoAdapter.readCreatedAt?.(card)).toBe(
      Date.parse("2026-08-23T12:00:00+09:00"),
    );
    expect(isNiconicoFilterPage("/search/music")).toBe(false);
    expect(isNiconicoFilterPage("/watch/sm123")).toBe(false);
  });

  it("現行の検索カードから重複せず動画情報を読む", () => {
    const page = render(`
      <div>
        <div data-decoration-video-id="sm456">
          <a href="/watch/sm456">4:06</a>
          <a href="/watch/sm456">動画タイトル</a>
          <div>
            <time datetime="2026-08-21T15:00:00.000Z">2026/8/22</time>
            <p><svg></svg><span>7.9万</span></p>
            <p><svg></svg><span>1.8万</span></p>
          </div>
        </div>
      </div>
    `);
    const card = niconicoAdapter.getPostCards(page)[0];
    if (!card) throw new Error("動画カードが無い");

    expect(niconicoAdapter.getPostCards(page)).toHaveLength(1);
    expect(niconicoAdapter.readPostId?.(card)).toBe("sm456");
    expect(niconicoAdapter.readMetricCount(card)).toBe(79000);
  });

  it("カードの描画途中に追加されたリンク要素は拾わない", () => {
    const page = render(`
      <div>
        <div><a href="/watch/sm456">動画タイトル</a></div>
      </div>
    `);

    expect(niconicoAdapter.getPostCards(page)).toHaveLength(0);
  });

  it("ユーザーが集合を限定するページだけを対象にする", () => {
    expect(isNiconicoFilterPage("/search/music")).toBe(false);
    expect(isNiconicoFilterPage("/tag/VOCALOID")).toBe(false);
    expect(isNiconicoFilterPage("/user/123/video")).toBe(true);
    expect(isNiconicoFilterPage("/user/123/mylist/456")).toBe(false);
    expect(isNiconicoFilterPage("/newarrival")).toBe(false);
  });
});
