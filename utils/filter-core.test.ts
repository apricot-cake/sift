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

  it("韓国語の千/만/억の単位を読む", () => {
    expect(parseMetric("1.2만")).toBe(12000);
  });

  it("簡体中文の万/亿の単位を読む", () => {
    expect(parseMetric("1.2亿")).toBe(120000000);
  });

  it("ポルトガル語（ブラジル）の mil/bi を読む", () => {
    expect(parseMetric("1,2 mil")).toBe(1200);
    expect(parseMetric("1,2 bi")).toBe(1200000000);
  });

  it("ドイツ語の Mio./Mrd. を読む", () => {
    expect(parseMetric("1,2 Mio.")).toBe(1200000);
    expect(parseMetric("1,2 Mrd.")).toBe(1200000000);
  });

  it("トルコ語の Mn/Mr を読む", () => {
    expect(parseMetric("1,2 Mn")).toBe(1200000);
    expect(parseMetric("1,2 Mr")).toBe(1200000000);
  });

  it("スペイン語の mil/M/k を読む", () => {
    expect(parseMetric("1,2 mil")).toBe(1200);
    expect(parseMetric("1,2 M")).toBe(1200000);
    expect(parseMetric("12 k")).toBe(12000);
  });

  it("表に無いラテン文字の連なりは単位ではなく散文として無視する", () => {
    expect(parseMetric("1,234 likes")).toBe(1234);
    expect(parseMetric("11788 Likes. Like")).toBe(11788);
  });

  it("2文字以上の綴りは、頭1文字だけの単位に飲まれない（語境界）", () => {
    // ベトナム語の Tr（100万）。頭の T だけを見て判定不能を返すと壊れる。
    expect(parseMetric("1.2Tr")).toBe(1200000);
  });

  it("単位だと分かっているが桁が決まらない綴りは判定不能（NaN）を返す", () => {
    // T はベトナム語では10億、デンマーク語では1,000で、ページの言語を
    // 読まない限り決められない。
    expect(Number.isNaN(parseMetric("1,2 T"))).toBe(true);
  });

  it("1文字の B / M は英語の読みのまま据え置く（#82 の残）", () => {
    // トルコ語の B は本来1,000（bin）だが、英語の10億として読む。
    expect(parseMetric("1,2 B")).toBe(1200000000);
    // インドネシア語の M は本来10億（miliar）だが、英語の100万として読む。
    expect(parseMetric("1,2 M")).toBe(1200000);
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

  it("反応数が判定不能（NaN）な投稿は隠さずに残す", () => {
    expect(
      classifyPost(
        {
          hasMedia: true,
          likeCount: Number.NaN,
          createdAtMs: now,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "hit", reason: "indeterminate-metric" });
  });

  it("反応数が判定不能でも、メディアが無い投稿は隠す", () => {
    expect(
      classifyPost(
        {
          hasMedia: false,
          likeCount: Number.NaN,
          createdAtMs: now,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "no-media" });
  });

  it("反応数が判定不能でも、設定が入っていればリポストは隠す", () => {
    expect(
      classifyPost(
        {
          hasMedia: true,
          likeCount: Number.NaN,
          createdAtMs: now,
          isRepost: true,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "repost" });
  });
});
