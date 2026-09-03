import { describe, expect, it } from "vitest";
import {
  type ClassifyThresholds,
  classifyPost,
  parseMetric,
} from "./filter-core.ts";

const settings: ClassifyThresholds = {
  mediaEnabled: false,
  inclusion: { minimum: 500, maximumAgeHours: null },
  hideReplies: false,
  hideQuotes: false,
  hideReposts: true,
};

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

  it("2文字以上の綴りは、頭1文字だけの単位に飲まれない", () => {
    expect(parseMetric("1.2Tr")).toBe(1200000);
  });

  it("単位だと分かっているが桁が決まらない綴りは判定不能にする", () => {
    expect(Number.isNaN(parseMetric("1,2 T"))).toBe(true);
  });
});

describe("classifyPost", () => {
  it("最低値を満たす投稿を残す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 500,
          createdAtMs: Number.NaN,
          isReply: false,
          isQuote: false,
          isRepost: false,
        },
        settings,
      ),
    ).toEqual({ state: "matched", reason: "filter-match" });
  });

  it("最低値を満たさない投稿を隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 499,
          createdAtMs: Number.NaN,
          isReply: false,
          isQuote: false,
          isRepost: false,
        },
        settings,
      ),
    ).toEqual({ state: "hidden", reason: "below-threshold" });
  });

  it("最低値が無効なら線を付けずに表示する", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 0,
          createdAtMs: Number.NaN,
          isReply: false,
          isQuote: false,
          isRepost: false,
        },
        {
          ...settings,
          inclusion: { minimum: null, maximumAgeHours: null },
        },
      ),
    ).toEqual({ state: "visible", reason: "no-inclusion-filter" });
  });

  it("メディア条件がオンのときだけ一致しない投稿を隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: false,
          metricCount: 1000,
          createdAtMs: Number.NaN,
          isReply: false,
          isQuote: false,
          isRepost: false,
        },
        { ...settings, mediaEnabled: true },
      ),
    ).toEqual({ state: "hidden", reason: "no-media" });
  });

  it("設定が入っている間、リポストは隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 1000,
          createdAtMs: Number.NaN,
          isReply: false,
          isQuote: false,
          isRepost: true,
        },
        settings,
      ),
    ).toEqual({ state: "hidden", reason: "repost" });
  });

  it("設定が入っている間、返信を隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 1000,
          createdAtMs: Number.NaN,
          isReply: true,
          isQuote: false,
          isRepost: false,
        },
        { ...settings, hideReplies: true },
      ),
    ).toEqual({ state: "hidden", reason: "reply" });
  });

  it("設定が入っている間、引用投稿を隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 1000,
          createdAtMs: Number.NaN,
          isReply: false,
          isQuote: true,
          isRepost: false,
        },
        { ...settings, hideQuotes: true },
      ),
    ).toEqual({ state: "hidden", reason: "quote" });
  });

  it("指標が判定不能な投稿は線を付けずに残す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: Number.NaN,
          createdAtMs: Number.NaN,
          isReply: false,
          isQuote: false,
          isRepost: false,
        },
        settings,
      ),
    ).toEqual({ state: "visible", reason: "indeterminate-metric" });
  });

  it("公開時期だけを指定して期間内の動画を残す", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 0,
          createdAtMs: now - 23 * 3600000,
          isReply: false,
          isQuote: false,
          isRepost: false,
        },
        {
          ...settings,
          inclusion: { minimum: null, maximumAgeHours: 24 },
        },
        now,
      ),
    ).toEqual({ state: "matched", reason: "filter-match" });
  });

  it("指定した公開時期より古い動画を隠す", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 500,
          createdAtMs: now - 25 * 3600000,
          isReply: false,
          isQuote: false,
          isRepost: false,
        },
        {
          ...settings,
          inclusion: { minimum: 500, maximumAgeHours: 24 },
        },
        now,
      ),
    ).toEqual({ state: "hidden", reason: "outside-period" });
  });

  it("公開時期を読めない動画は隠さない", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 500,
          createdAtMs: Number.NaN,
          isReply: false,
          isQuote: false,
          isRepost: false,
        },
        {
          ...settings,
          inclusion: { minimum: 500, maximumAgeHours: 24 },
        },
      ),
    ).toEqual({ state: "visible", reason: "indeterminate-age" });
  });
});
