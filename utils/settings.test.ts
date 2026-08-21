import { describe, expect, it } from "vitest";
import {
  defaults,
  excludedKeywordsFrom,
  isSiteEnabled,
  normalizeSettings,
  settingsFor,
  thresholdsFor,
  withSiteEnabled,
  withSiteSettings,
} from "./settings.ts";

describe("normalizeSettings", () => {
  it("サイト別の値を自分の範囲へ収める", () => {
    const settings = normalizeSettings({
      siteSettings: {
        misskey: { minReactions: "-4", risingMinReactions: "35" },
      },
    });
    expect(settings.siteSettings.misskey.minReactions).toBe(0);
    expect(settings.siteSettings.misskey.risingMinReactions).toBe(35);
  });

  it("メディアを指定しない既定値は本文だけの投稿も含める", () => {
    expect(defaults.siteSettings.x.mediaMode).toBe("all");
    expect(normalizeSettings({}).siteSettings.bluesky.mediaMode).toBe("all");
  });

  it("インスタンス一覧から不正なホストと重複を落とす", () => {
    expect(
      normalizeSettings({
        misskeyInstances: ["misskey.io", "misskey.io", "http://bad", "x.com"],
      }).misskeyInstances,
    ).toEqual(["misskey.io", "x.com"]);
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

  it("旧版の全体OFFをサイトごとの既定OFFへ移行する", () => {
    const settings = normalizeSettings({ enabled: false });
    expect(isSiteEnabled(settings, "x.com")).toBe(false);
    expect(isSiteEnabled(settings, "misskey.example")).toBe(false);
  });

  it("ホストごとに抽出の有効・無効を分ける", () => {
    const settings = withSiteEnabled(normalizeSettings({}), "x.com", false);
    expect(isSiteEnabled(settings, "x.com")).toBe(false);
    expect(isSiteEnabled(settings, "bsky.app")).toBe(true);
  });

  it("旧共有設定を全サイトへ引き継ぐ", () => {
    const settings = normalizeSettings({
      minLikes: 42,
      risingMinLikes: 7,
      risingEnabled: false,
      risingMaxAgeHours: 12,
      mediaMode: "images",
      excludedKeywords: "spoiler",
      hideReposts: false,
      misskeyMinReactions: 9,
      misskeyRisingMinReactions: 2,
    });
    expect(settings.siteSettings.x).toMatchObject({
      minReactions: 42,
      risingMinReactions: 7,
      risingEnabled: false,
      risingMaxAgeHours: 12,
      mediaMode: "images",
      excludedKeywords: "spoiler",
      hideReposts: false,
    });
    expect(settings.siteSettings.bluesky).toEqual(settings.siteSettings.x);
    expect(settings.siteSettings.misskey.minReactions).toBe(9);
    expect(settings.siteSettings.misskey.risingMinReactions).toBe(2);
  });

  it("XとBlueskyの設定一式を独立して保持する", () => {
    const base = normalizeSettings({});
    const changed = withSiteSettings(base, "bluesky", {
      ...settingsFor(base, "bluesky"),
      mediaMode: "video",
      minReactions: 25,
      risingMinReactions: 4,
      excludedKeywords: "release",
    });
    expect(changed.siteSettings.x).toEqual(defaults.siteSettings.x);
    expect(changed.siteSettings.bluesky).toMatchObject({
      mediaMode: "video",
      minReactions: 25,
      risingMinReactions: 4,
      excludedKeywords: "release",
    });
  });
});

describe("thresholdsFor", () => {
  it("選択したサイトの設定から判定条件を埋める", () => {
    const stored = normalizeSettings({
      siteSettings: {
        bluesky: {
          minReactions: 25,
          risingEnabled: true,
          risingMinReactions: 4,
          risingMaxAgeHours: 8,
          excludedKeywords: "spoiler",
          hideReposts: false,
        },
      },
    });
    expect(thresholdsFor(stored.siteSettings.bluesky)).toEqual({
      excludedKeywords: ["spoiler"],
      hideReposts: false,
      minLikes: 25,
      risingEnabled: true,
      risingMinLikes: 4,
      risingMaxAgeHours: 8,
    });
  });
});
