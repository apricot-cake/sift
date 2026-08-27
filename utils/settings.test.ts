import { describe, expect, it } from "vitest";
import {
  defaults,
  excludedKeywordsFrom,
  normalizeSettings,
  periodInHours,
  settingsFor,
  thresholdsFor,
  withoutSourceSettings,
  withSiteSettings,
  withSourceSettings,
} from "./settings.ts";

describe("normalizeSettings", () => {
  it("サイト別の値を自分の範囲へ収める", () => {
    const settings = normalizeSettings({
      siteSettings: {
        bluesky: { minReactions: "-4", periodValue: "35" },
      },
    });
    expect(settings.siteSettings.bluesky.minReactions).toBe(0);
    expect(settings.siteSettings.bluesky.periodValue).toBe(35);
  });

  it("サイトごとに既定値を持つ", () => {
    expect(defaults.siteSettings.x).toMatchObject({
      minReactions: 1000,
      periodMode: "all",
      periodValue: 6,
      periodUnit: "hour",
    });
    expect(defaults.siteSettings.bluesky.minReactions).toBe(1000);
    expect(defaults.siteSettings.youtube).toMatchObject({
      minCount: 10000,
      periodMode: "all",
      periodValue: 1,
      periodUnit: "week",
    });
    expect(defaults.siteSettings.niconico.minCount).toBe(1000);
    expect(defaults.siteSettings.soundcloud.minCount).toBe(1000);
  });

  it("メディアを指定しない既定値は本文だけの投稿も含める", () => {
    expect(defaults.siteSettings.x.mediaEnabled).toBe(false);
    expect(defaults.siteSettings.x.mediaMode).toBe("all");
    expect(normalizeSettings({}).siteSettings.bluesky.mediaMode).toBe("all");
  });

  it("除外キーワードをサイト別に正規化する", () => {
    const settings = normalizeSettings({
      siteSettings: {
        bluesky: { excludedKeywords: " spoiler \n\nSPOILER\nNew release " },
      },
    });
    expect(settings.siteSettings.bluesky.excludedKeywords).toBe(
      "spoiler\nNew release",
    );
    expect(
      excludedKeywordsFrom(settings.siteSettings.bluesky.excludedKeywords),
    ).toEqual(["spoiler", "new release"]);
  });

  it("XとBlueskyの設定一式を独立して保持する", () => {
    const base = normalizeSettings({});
    const changed = withSiteSettings(base, "bluesky", {
      ...settingsFor(base, "bluesky"),
      mediaMode: "video",
      minReactions: 25,
      periodMode: "limited",
      periodValue: 2,
      periodUnit: "week",
      excludedKeywords: "release",
    });
    expect(changed.siteSettings.x).toEqual(defaults.siteSettings.x);
    expect(changed.siteSettings.bluesky).toMatchObject({
      mediaMode: "video",
      minReactions: 25,
      periodMode: "limited",
      periodValue: 2,
      periodUnit: "week",
      excludedKeywords: "release",
    });
  });

  it("再生数を使うサービスの設定を独立して保持する", () => {
    const base = normalizeSettings({});
    const changed = withSiteSettings(base, "youtube", {
      ...settingsFor(base, "youtube"),
      minCount: 20000,
      periodMode: "limited",
      periodValue: 3,
      periodUnit: "month",
    });

    expect(changed.siteSettings.youtube).toMatchObject({
      minCount: 20000,
      periodMode: "limited",
      periodValue: 3,
      periodUnit: "month",
    });
    expect(changed.siteSettings.x).toEqual(base.siteSettings.x);
    expect(changed.siteSettings.niconico).toEqual(base.siteSettings.niconico);
    expect(changed.siteSettings.soundcloud).toEqual(
      base.siteSettings.soundcloud,
    );
  });

  it("場所を編集したときだけサイト既定値から個別設定を作る", () => {
    const base = normalizeSettings({});
    const changed = withSourceSettings(base, "x", "list:123", "開発", {
      ...settingsFor(base, "x"),
      minReactions: 250,
    });

    expect(settingsFor(base, "x", "list:123")).toEqual(base.siteSettings.x);
    expect(settingsFor(changed, "x", "list:123").minReactions).toBe(250);
    expect(changed.siteSettings.x.minReactions).toBe(1000);
  });

  it("個別設定を削除するとサイト既定値へ戻る", () => {
    const base = normalizeSettings({});
    const changed = withSourceSettings(base, "bluesky", "feed:abc", "技術", {
      ...settingsFor(base, "bluesky"),
      minReactions: 50,
    });
    const reset = withoutSourceSettings(changed, "bluesky", "feed:abc");

    expect(settingsFor(reset, "bluesky", "feed:abc")).toEqual(
      base.siteSettings.bluesky,
    );
    expect(reset.sourceSettings).toEqual({});
  });
});

describe("periodInHours", () => {
  it("各単位を時間へ換算する", () => {
    expect(periodInHours(2, "hour")).toBe(2);
    expect(periodInHours(2, "day")).toBe(48);
    expect(periodInHours(2, "week")).toBe(336);
    expect(periodInHours(2, "month")).toBe(1440);
    expect(periodInHours(2, "year")).toBe(17520);
  });
});

describe("thresholdsFor", () => {
  it("選択したサイトの設定から期間指定の判定条件を作る", () => {
    const stored = normalizeSettings({
      siteSettings: {
        bluesky: {
          minReactions: 25,
          periodMode: "limited",
          periodValue: 2,
          periodUnit: "day",
          excludedKeywordsEnabled: true,
          excludedKeywords: "spoiler",
          hideReposts: false,
        },
      },
    });
    expect(thresholdsFor(stored.siteSettings.bluesky)).toEqual({
      excludedKeywords: ["spoiler"],
      hideReposts: false,
      mediaEnabled: false,
      inclusion: {
        enabled: true,
        minimum: 25,
        maximumAgeHours: 48,
      },
    });
  });

  it("再生数の全期間条件は公開時期で制限しない", () => {
    const stored = normalizeSettings({
      siteSettings: {
        youtube: {
          minCount: 20000,
          minCountEnabled: true,
          periodMode: "all",
        },
      },
    });

    expect(thresholdsFor(stored.siteSettings.youtube)).toEqual({
      excludedKeywords: [],
      hideReposts: false,
      mediaEnabled: false,
      inclusion: {
        enabled: true,
        minimum: 20000,
        maximumAgeHours: null,
      },
    });
  });
});
