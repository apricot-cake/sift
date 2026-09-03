import { describe, expect, it } from "vitest";
import {
  defaults,
  normalizeSettings,
  publicationPeriodInHours,
  settingsFor,
  thresholdsFor,
  withSiteSettings,
} from "./settings.ts";

describe("normalizeSettings", () => {
  it("サイト別の値を自分の範囲へ収める", () => {
    const settings = normalizeSettings({
      siteSettings: {
        bluesky: { minReactions: "-4" },
      },
    });
    expect(settings.siteSettings.bluesky.minReactions).toBe(0);
  });

  it("サイトごとに既定値を持つ", () => {
    expect(defaults.siteSettings.x).toMatchObject({
      minReactions: 1000,
    });
    expect(defaults.siteSettings.bluesky.minReactions).toBe(1000);
    expect(defaults.siteSettings.youtube).toMatchObject({
      minCount: 10000,
      publishedWithinEnabled: false,
      publishedWithinValue: 1,
      publishedWithinUnit: "week",
    });
    expect(defaults.siteSettings.niconico.minCount).toBe(1000);
  });

  it("メディア条件は無効で、オンにしたときはメディアありを既定にする", () => {
    expect(defaults.siteSettings.x.mediaEnabled).toBe(false);
    expect(defaults.siteSettings.x.mediaMode).toBe("any");
    expect(normalizeSettings({}).siteSettings.bluesky.mediaMode).toBe("any");
  });

  it("返信と引用投稿は既定では除外しない", () => {
    expect(defaults.siteSettings.x.hideReplies).toBe(false);
    expect(defaults.siteSettings.x.hideQuotes).toBe(false);
    expect(defaults.siteSettings.bluesky.hideReplies).toBe(false);
    expect(defaults.siteSettings.bluesky.hideQuotes).toBe(false);
  });

  it("選択肢にない旧メディア設定をメディアありへ移行する", () => {
    const settings = normalizeSettings({
      siteSettings: {
        x: { mediaEnabled: true, mediaMode: "all" },
      },
    });

    expect(settings.siteSettings.x.mediaEnabled).toBe(true);
    expect(settings.siteSettings.x.mediaMode).toBe("any");
  });

  it("廃止した除外キーワード設定は読み込まない", () => {
    const settings = normalizeSettings({
      siteSettings: {
        bluesky: {
          excludedKeywordsEnabled: true,
          excludedKeywords: "spoiler",
        },
      },
    });
    expect("excludedKeywordsEnabled" in settings.siteSettings.bluesky).toBe(
      false,
    );
    expect("excludedKeywords" in settings.siteSettings.bluesky).toBe(false);
  });

  it("XとBlueskyの設定一式を独立して保持する", () => {
    const base = normalizeSettings({});
    const changed = withSiteSettings(base, "bluesky", {
      ...settingsFor(base, "bluesky"),
      mediaMode: "video",
      minReactions: 25,
    });
    expect(changed.siteSettings.x).toEqual(defaults.siteSettings.x);
    expect(changed.siteSettings.bluesky).toMatchObject({
      mediaMode: "video",
      minReactions: 25,
    });
  });

  it("再生数を使うサービスの設定を独立して保持する", () => {
    const base = normalizeSettings({});
    const changed = withSiteSettings(base, "youtube", {
      ...settingsFor(base, "youtube"),
      minCount: 20000,
    });

    expect(changed.siteSettings.youtube).toMatchObject({
      minCount: 20000,
    });
    expect(changed.siteSettings.x).toEqual(base.siteSettings.x);
    expect(changed.siteSettings.niconico).toEqual(base.siteSettings.niconico);
  });

  it("廃止したSoundCloud設定は読み込まない", () => {
    const settings = normalizeSettings({
      siteSettings: { soundcloud: { minCount: 1 } },
    });

    expect(settings.siteSettings).toEqual(defaults.siteSettings);
    expect("soundcloud" in settings.siteSettings).toBe(false);
  });

  it("旧形式のページ別設定は読み込まない", () => {
    const settings = normalizeSettings({
      sourceSettings: {
        "x:list:123": {
          site: "x",
          label: "開発",
          settings: { minReactions: 250 },
        },
      },
    });

    expect(settings).toEqual({ siteSettings: defaults.siteSettings });
  });

  it("廃止した投稿時期設定を公開時期設定として読み込まない", () => {
    const settings = normalizeSettings({
      siteSettings: {
        x: {
          periodMode: "limited",
          periodValue: 2,
          periodUnit: "day",
        },
      },
    });

    expect("periodMode" in settings.siteSettings.x).toBe(false);
    expect("periodValue" in settings.siteSettings.x).toBe(false);
    expect("periodUnit" in settings.siteSettings.x).toBe(false);
    expect(settings.siteSettings.youtube.publishedWithinEnabled).toBe(false);
  });
});

describe("publicationPeriodInHours", () => {
  it("各単位を時間へ換算する", () => {
    expect(publicationPeriodInHours(2, "hour")).toBe(2);
    expect(publicationPeriodInHours(2, "day")).toBe(48);
    expect(publicationPeriodInHours(2, "week")).toBe(336);
    expect(publicationPeriodInHours(2, "month")).toBe(1440);
    expect(publicationPeriodInHours(2, "year")).toBe(17520);
  });
});

describe("thresholdsFor", () => {
  it("選択したサイトの設定から反応数の判定条件を作る", () => {
    const stored = normalizeSettings({
      siteSettings: {
        bluesky: {
          minReactions: 25,
          hideReplies: true,
          hideQuotes: true,
          hideReposts: false,
        },
      },
    });
    expect(thresholdsFor(stored.siteSettings.bluesky)).toEqual({
      hideReplies: true,
      hideQuotes: true,
      hideReposts: false,
      mediaEnabled: false,
      inclusion: {
        minimum: 25,
        maximumAgeHours: null,
      },
    });
  });

  it("再生数の判定条件を作る", () => {
    const stored = normalizeSettings({
      siteSettings: {
        youtube: {
          minCount: 20000,
          minCountEnabled: true,
          publishedWithinEnabled: true,
          publishedWithinValue: 2,
          publishedWithinUnit: "week",
        },
      },
    });

    expect(thresholdsFor(stored.siteSettings.youtube)).toEqual({
      hideReplies: false,
      hideQuotes: false,
      hideReposts: false,
      mediaEnabled: false,
      inclusion: {
        minimum: 20000,
        maximumAgeHours: 336,
      },
    });
  });

  it("最低値を無効にすると反応数の判定条件を外す", () => {
    const stored = normalizeSettings({
      siteSettings: {
        x: {
          minReactionsEnabled: false,
        },
      },
    });

    expect(thresholdsFor(stored.siteSettings.x).inclusion).toEqual({
      minimum: null,
      maximumAgeHours: null,
    });
  });
});
