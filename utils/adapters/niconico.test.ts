import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { isNiconicoFilterPage, niconicoAdapter } from "./niconico.ts";

describe("ニコニコ動画", () => {
  it("一覧カードの動画ID、再生数、公開時刻を読む", () => {
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
    expect(niconicoAdapter.readCreatedAt(card)).toBe(
      Date.parse("2026-08-23T12:00:00+09:00"),
    );
    expect(niconicoAdapter.readText(card)).toBe("動画タイトル");
    expect(isNiconicoFilterPage("/search/music")).toBe(true);
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
    expect(niconicoAdapter.readText(card)).toBe("動画タイトル");
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
    expect(isNiconicoFilterPage("/search/music")).toBe(true);
    expect(isNiconicoFilterPage("/tag/VOCALOID")).toBe(true);
    expect(isNiconicoFilterPage("/user/123/video")).toBe(true);
    expect(isNiconicoFilterPage("/user/123/mylist/456")).toBe(true);
    expect(isNiconicoFilterPage("/newarrival")).toBe(false);
  });
});
