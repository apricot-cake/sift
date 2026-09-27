import { describe, expect, it } from "vitest";
import { render } from "../test/dom.ts";
import { readYouTubeSortOrder, youtubeAdapter } from "./adapters/youtube.ts";
import { classifyPost } from "./filter-core.ts";
import {
  countWithinPeriod,
  PUBLICATION_PERIODS,
} from "./publication-period.ts";
import { defaults, normalizeSettings, thresholdsFor } from "./settings.ts";

describe("再生回数順の投稿期間", () => {
  const now = 1800000000000;
  const day = 86400000;
  const settings = {
    ...defaults.siteSettings.youtube,
    minCountEnabled: true,
    minCount: 1000000,
    hidePublishedWithinEnabled: true,
    postedWithinDays: 30,
  };
  const post = {
    mediaMatches: true,
    metricCount: 1,
    createdAtMs: now - 30 * day,
    isReply: false,
    isQuote: false,
    isRepost: false,
  };
  it.each(["newest", "popular"])(
    "ショートの%sでは日付不明でも最低再生回数を適用する",
    (sort) => {
      const supportsAge = youtubeAdapter.supportsPublicationAge({
        pathname: "/@channel/shorts",
      });
      const thresholds = thresholdsFor(settings, sort, supportsAge);
      expect(thresholds.inclusion).toEqual({
        minimum: 1000000,
        minimumAgeHours: null,
      });
      expect(
        classifyPost({ ...post, createdAtMs: NaN }, thresholds, now).state,
      ).toBe("hidden");
      expect(
        classifyPost(
          { ...post, metricCount: 1000000, createdAtMs: NaN },
          thresholds,
          now,
        ).state,
      ).toBe("matched");
      expect(
        thresholdsFor(
          { ...settings, minCountEnabled: false },
          sort,
          supportsAge,
        ).inclusion.minimum,
      ).toBeNull();
      expect(
        youtubeAdapter.supportsPublicationAge({ pathname: "/@channel/videos" }),
      ).toBe(true);
      expect(
        youtubeAdapter.supportsPublicationAge({
          pathname: "/@channel/streams",
        }),
      ).toBe(true);
    },
  );
  it("期間の境界を含め、古い動画を除外する", () => {
    const thresholds = thresholdsFor(settings, "popular");
    expect(classifyPost(post, thresholds, now).state).toBe("matched");
    expect(
      classifyPost(
        { ...post, createdAtMs: now - 30 * day - 1 },
        thresholds,
        now,
      ).reason,
    ).toBe("older-than-period");
  });
  it("投稿日時が不明なら誤って隠さない", () => {
    expect(
      classifyPost(
        { ...post, createdAtMs: NaN },
        thresholdsFor(settings, "popular"),
        now,
      ).state,
    ).toBe("visible");
  });
  it("並び順が戻ると従来条件へ戻り、期間条件は適用しない", () => {
    expect(thresholdsFor(settings, "newest").inclusion).toEqual({
      minimum: 1000000,
      minimumAgeHours: 8760,
    });
    expect(
      thresholdsFor({ ...settings, postedWithinDays: 0 }, "popular").inclusion,
    ).toEqual({ minimum: null, minimumAgeHours: null, maximumAgeHours: null });
  });
  it("件数を同じ境界で計算し、0件の候補も固定で残す", () => {
    expect(
      countWithinPeriod(
        [now - day, now - 30 * day, now - 31 * day, NaN],
        30,
        now,
      ),
    ).toBe(2);
    expect(
      PUBLICATION_PERIODS.map((p) => countWithinPeriod([], p.days, now)),
    ).toEqual(Array(10).fill(0));
  });
  it("入力した期間と選択した期間を別々に保存する", () => {
    const normalized = normalizeSettings({
      siteSettings: {
        youtube: { postedWithinDays: 365, manualPeriodDays: 42 },
      },
    });
    expect(normalized.siteSettings.youtube.postedWithinDays).toBe(365);
    expect(normalized.siteSettings.youtube.manualPeriodDays).toBe(42);
  });
  it("選択中のチップから判定し、未選択や別ページを誤認しない", () => {
    const root = render(
      '<ytd-browse><button role="tab" aria-selected="true">新しい順</button><button role="tab" aria-selected="false">人気の動画</button></ytd-browse>',
    );
    expect(readYouTubeSortOrder(root, { pathname: "/@Google/videos" })).toBe(
      "newest",
    );
    const buttons = root.querySelectorAll("button");
    buttons[0]?.setAttribute("aria-selected", "false");
    buttons[1]?.setAttribute("aria-selected", "true");
    expect(readYouTubeSortOrder(root, { pathname: "/@Google/videos" })).toBe(
      "popular",
    );
    expect(readYouTubeSortOrder(root, { pathname: "/results" })).toBe(
      "unknown",
    );
  });
  it("英語・旧チップにも対応し、不明な並び順は推測しない", () => {
    expect(
      readYouTubeSortOrder(
        render(
          "<ytd-browse><yt-chip-cloud-chip-renderer selected>Popular</yt-chip-cloud-chip-renderer></ytd-browse>",
        ),
        { pathname: "/@Google/shorts" },
      ),
    ).toBe("popular");
    expect(
      readYouTubeSortOrder(
        render(
          '<ytd-browse><button aria-selected="true" role="tab">古い順</button></ytd-browse>',
        ),
        { pathname: "/@Google/videos" },
      ),
    ).toBe("unknown");
  });
});
