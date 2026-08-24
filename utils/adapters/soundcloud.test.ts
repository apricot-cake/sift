import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import { isSoundCloudFilterPage, soundcloudAdapter } from "./soundcloud.ts";

describe("SoundCloud", () => {
  it("検索結果のトラックURL、再生数、公開時刻を読む", () => {
    const card = render(`
      <li class="searchItem">
        <div class="sound">
          <a class="soundTitle__title" href="/artist/track">Track title</a>
          <time datetime="2025-10-16T21:06:05.000Z"></time>
          <span title="6,627,789 plays"><span class="sc-ministats-plays">6.6M</span></span>
        </div>
      </li>
    `).firstElementChild;
    if (!card) throw new Error("トラックカードが無い");

    expect(
      soundcloudAdapter.getPostCards(card.parentElement ?? card),
    ).toHaveLength(1);
    expect(soundcloudAdapter.readPostId?.(card)).toBe("/artist/track");
    expect(soundcloudAdapter.readMetricCount(card)).toBe(6627789);
    expect(soundcloudAdapter.readCreatedAt(card)).toBe(
      Date.parse("2025-10-16T21:06:05.000Z"),
    );
    expect(soundcloudAdapter.readText(card)).toBe("Track title");
  });

  it("検索、フィード、ユーザーのトラック一覧だけを対象にする", () => {
    expect(isSoundCloudFilterPage("/search/sounds")).toBe(true);
    expect(isSoundCloudFilterPage("/feed")).toBe(true);
    expect(isSoundCloudFilterPage("/artist/tracks")).toBe(true);
    expect(isSoundCloudFilterPage("/discover")).toBe(false);
  });
});
