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
});
