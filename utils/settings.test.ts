import { describe, expect, it } from "vitest";
import {
  defaults,
  normalizeSettings,
  settingsFor,
  thresholdsFor,
  withSiteSettings,
} from "./settings.ts";

describe("normalizeSettings", () => {
  it("対応を外したサイトの保存値を除外し、他サイトの値を維持する", () => {
    const settings = normalizeSettings({
      siteSettings: {
        x: { manualMinimum: 234, minReactions: 123 },
        fanbox: { kind: "likes", minReactions: 100 },
      },
    });
    expect(Object.keys(settings.siteSettings)).toEqual([
      "x",
      "bluesky",
      "youtube",
      "niconico",
    ]);
    expect(settings.siteSettings.x).toMatchObject({
      manualMinimum: 234,
      minReactions: 123,
    });
    expect(normalizeSettings(settings)).toEqual(settings);
  });
  it.each(["youtube", "niconico"] as const)(
    "%s は旧再生数・新しい動画除外・メンバー限定設定を捨て、投稿期間だけを保存する",
    (site) => {
      const saved = normalizeSettings({
        siteSettings: {
          [site]: {
            maxCountEnabled: true,
            maxCount: 12345,
            minCountEnabled: true,
            minCount: 999999,
            manualMinimum: 42,
            hidePublishedWithinEnabled: true,
            hidePublishedWithinValue: 2,
            hidePublishedWithinUnit: "year",
            hideMembersOnly: true,
            postedWithinDays: "365",
            manualPeriodDays: "42",
          },
        },
      });
      expect(saved.siteSettings[site]).toEqual({
        kind: "metric",
        postedWithinDays: 365,
        manualPeriodDays: 42,
      });
      expect(normalizeSettings(saved)).toEqual(saved);
    },
  );
  it.each(["x", "bluesky"] as const)(
    "%s の手動値を候補の適用値と別に保持する",
    (site) => {
      const settings = normalizeSettings({
        siteSettings: {
          [site]: {
            manualMinimum: 12345,
            minCount: 50000,
            minReactions: 50000,
          },
        },
      });
      const stored = settingsFor(settings, site);
      expect(stored.manualMinimum).toBe(12345);
      expect(stored.minReactions).toBe(50000);
      expect(settingsFor(normalizeSettings(settings), site).manualMinimum).toBe(
        12345,
      );
    },
  );
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
    expect(defaults.siteSettings.youtube).toEqual({ kind: "metric" });
    expect(defaults.siteSettings.niconico).toEqual({ kind: "metric" });
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
      postedWithinDays: 365,
    });

    expect(changed.siteSettings.youtube).toMatchObject({
      postedWithinDays: 365,
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

  it("旧形式の期間内だけ表示を新しい動画の除外として読み込まない", () => {
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
    expect(settings.siteSettings.youtube).toEqual({ kind: "metric" });
  });

  it("旧形式の公開時期設定を有効な新しい動画の除外へ移行しない", () => {
    const settings = normalizeSettings({
      siteSettings: {
        youtube: {
          publishedWithinEnabled: true,
          publishedWithinValue: 2,
          publishedWithinUnit: "week",
        },
      },
    });

    expect(settings.siteSettings.youtube).toEqual({ kind: "metric" });
    expect("publishedWithinEnabled" in settings.siteSettings.youtube).toBe(
      false,
    );
  });
});

describe("thresholdsFor", () => {
  it.each(["youtube", "niconico"] as const)(
    "%s は再生数順で投稿期間だけを適用する",
    (site) => {
      const settings = normalizeSettings({
        siteSettings: {
          [site]: {
            minCountEnabled: true,
            minCount: 10000,
            maxCountEnabled: true,
            maxCount: 100,
            hidePublishedWithinEnabled: true,
            hideMembersOnly: true,
            postedWithinDays: 30,
          },
        },
      }).siteSettings[site];
      expect(thresholdsFor(settings, "popular").inclusion).toEqual({
        minimum: null,
        maximumAgeHours: 720,
      });
      for (const sort of [
        "newest",
        "default",
        "relevance",
        "unknown",
        undefined,
      ])
        expect(thresholdsFor(settings, sort).inclusion).toEqual({
          minimum: null,
          maximumAgeHours: null,
        });
      expect(
        thresholdsFor({ ...settings, postedWithinDays: 0 }, "popular").inclusion
          .maximumAgeHours,
      ).toBeNull();
    },
  );
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
    });
  });
});
