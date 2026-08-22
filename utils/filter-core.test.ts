import { describe, expect, it } from "vitest";
import {
  type ClassifyThresholds,
  classifyPost,
  parseMetric,
} from "./filter-core.ts";

const settings: ClassifyThresholds = {
  excludedKeywords: [],
  mediaEnabled: false,
  inclusion: { enabled: true, minimum: 500, maximumAgeHours: null },
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

  it("2文字以上の綴りは、頭1文字だけの単位に飲まれない", () => {
    expect(parseMetric("1.2Tr")).toBe(1200000);
  });

  it("単位だと分かっているが桁が決まらない綴りは判定不能にする", () => {
    expect(Number.isNaN(parseMetric("1,2 T"))).toBe(true);
  });
});

describe("classifyPost", () => {
  it("全期間では投稿時期に関係なく最低値で判定する", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 500,
          createdAtMs: now - 5 * 365 * 24 * 3600000,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "matched", reason: "filter-match" });
  });

  it("期間を指定すると期間と最低値を両方満たす投稿を残す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 500,
          createdAtMs: now - 2 * 3600000,
          isRepost: false,
        },
        {
          ...settings,
          inclusion: { ...settings.inclusion, maximumAgeHours: 6 },
        },
        now,
      ),
    ).toEqual({ state: "matched", reason: "filter-match" });
  });

  it("指定した期間を過ぎた投稿は最低値を満たしても隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 500,
          createdAtMs: now - 7 * 3600000,
          isRepost: false,
        },
        {
          ...settings,
          inclusion: { ...settings.inclusion, maximumAgeHours: 6 },
        },
        now,
      ),
    ).toEqual({ state: "hidden", reason: "below-threshold" });
  });

  it("期間を指定して投稿時期を読めない場合は線を付けずに残す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 500,
          createdAtMs: Number.NaN,
          isRepost: false,
        },
        {
          ...settings,
          inclusion: { ...settings.inclusion, maximumAgeHours: 6 },
        },
        now,
      ),
    ).toEqual({ state: "visible", reason: "indeterminate-age" });
  });

  it("反応数フィルターがオフなら線を付けずに表示する", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 0,
          createdAtMs: Number.NaN,
          isRepost: false,
        },
        {
          ...settings,
          inclusion: { ...settings.inclusion, enabled: false },
        },
        now,
      ),
    ).toEqual({ state: "visible", reason: "no-inclusion-filter" });
  });

  it("メディア条件がオンのときだけ一致しない投稿を隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: false,
          metricCount: 1000,
          createdAtMs: now,
          isRepost: false,
        },
        { ...settings, mediaEnabled: true },
        now,
      ),
    ).toEqual({ state: "hidden", reason: "no-media" });
  });

  it("除外キーワードを含む投稿を隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 1000,
          createdAtMs: now,
          isRepost: false,
          text: "New trailer #Spoiler",
        },
        { ...settings, excludedKeywords: ["spoiler"] },
        now,
      ),
    ).toEqual({ state: "hidden", reason: "excluded-keyword" });
  });

  it("設定が入っている間、リポストは隠す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: 1000,
          createdAtMs: now,
          isRepost: true,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "hidden", reason: "repost" });
  });

  it("指標が判定不能な投稿は線を付けずに残す", () => {
    expect(
      classifyPost(
        {
          mediaMatches: true,
          metricCount: Number.NaN,
          createdAtMs: now,
          isRepost: false,
        },
        settings,
        now,
      ),
    ).toEqual({ state: "visible", reason: "indeterminate-metric" });
  });
});
