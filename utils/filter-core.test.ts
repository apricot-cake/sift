import { describe, expect, it } from "vitest";
import { classifyPost, parseMetric } from "./filter-core.ts";

const settings = {
  minLikes: 500,
  risingEnabled: true,
  risingMinLikes: 100,
  risingMaxAgeHours: 6,
  hideReposts: true,
};

const now = Date.parse("2026-08-01T12:00:00Z");

describe("parseMetric", () => {
  it("反応の数が書かれうる形を読む", () => {
    expect(parseMetric("1,234")).toBe(1234);
    expect(parseMetric("1.2K")).toBe(1200);
    expect(parseMetric("1.2万 件のいいね")).toBe(12000);
    expect(parseMetric("３５０ 件のいいね")).toBe(350);
    expect(parseMetric("11788 件のいいね。いいねする")).toBe(11788);
  });

  it("読めるものが無ければ 0 を返す", () => {
    expect(parseMetric("")).toBe(0);
  });
});

describe("classifyPost", () => {
  it("最低の反応数に届いた投稿は残す", () => {
    expect(
      classifyPost(
        {
          hasMedia: true,
          likeCount: 500,
          createdAtMs: now - 24 * 3600000,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "hit", reason: "minimum-likes" });
  });

  it("新しい投稿は、低い方の上昇中の数に届けば残す", () => {
    expect(
      classifyPost(
        {
          hasMedia: true,
          likeCount: 120,
          createdAtMs: now - 2 * 3600000,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "rising", reason: "rising" });
  });

  it("同じ投稿でも、上昇中の窓を過ぎたら隠す", () => {
    expect(
      classifyPost(
        {
          hasMedia: true,
          likeCount: 120,
          createdAtMs: now - 7 * 3600000,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "below-threshold" });
  });

  it("メディアの無い投稿は、数がいくつでも隠す", () => {
    expect(
      classifyPost(
        { hasMedia: false, likeCount: 1000, createdAtMs: now, isRepost: false },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "no-media" });
  });

  it("設定が入っている間、リポストは隠す", () => {
    expect(
      classifyPost(
        { hasMedia: true, likeCount: 1000, createdAtMs: now, isRepost: true },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "repost" });
  });
});
