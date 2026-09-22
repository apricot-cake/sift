import { describe, expect, it } from "vitest";
import { ADAPTERS, selectAdapter } from "../utils/adapters/index.ts";
import type { ServiceAdapter } from "../utils/adapters/types.ts";
import { classifyPost, type Post } from "../utils/filter-core.ts";
import {
  normalizeSettings,
  type SiteSettingsKey,
  settingsFor,
  thresholdsFor,
} from "../utils/settings.ts";
import { render } from "./dom.ts";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const BASE_POST: Post = {
  mediaMatches: true,
  metricCount: 1_000,
  createdAtMs: NOW - 48 * 3_600_000,
  isReply: false,
  isQuote: false,
  isRepost: false,
};

function classifyWith(
  site: SiteSettingsKey,
  values: unknown,
  post: Partial<Post> = {},
) {
  const settings = normalizeSettings({
    siteSettings: { [site]: values },
  });
  return classifyPost(
    { ...BASE_POST, ...post },
    thresholdsFor(settingsFor(settings, site)),
    NOW,
  );
}

interface PageCase {
  readonly name: string;
  readonly url: string;
  readonly adapter: ServiceAdapter;
  readonly accepted: { readonly pathname: string; readonly markup: string };
  readonly rejected: { readonly pathname: string; readonly markup: string };
}

const PAGE_CASES: readonly PageCase[] = [
  {
    name: "X",
    url: "https://x.com/home",
    adapter: ADAPTERS[0] as ServiceAdapter,
    accepted: {
      pathname: "/home",
      markup: `
        <div data-testid="ScrollSnap-List" role="tablist">
          <div role="tab" aria-selected="false">For you</div>
          <div role="tab" aria-selected="true">Following</div>
        </div>`,
    },
    rejected: {
      pathname: "/home",
      markup: `
        <div data-testid="ScrollSnap-List" role="tablist">
          <div role="tab" aria-selected="true">For you</div>
          <div role="tab" aria-selected="false">Following</div>
        </div>`,
    },
  },
  {
    name: "Bluesky",
    url: "https://bsky.app/",
    adapter: ADAPTERS[1] as ServiceAdapter,
    accepted: {
      pathname: "/",
      markup: `
        <div data-testid="homeScreenFeedTabs-selector-Following">
          Following<div style="background-color: blue"></div>
        </div>`,
    },
    rejected: {
      pathname: "/",
      markup:
        '<div data-testid="homeScreenFeedTabs-selector-Following">Following</div>',
    },
  },
  {
    name: "YouTube",
    url: "https://www.youtube.com/results?search_query=sift",
    adapter: ADAPTERS[2] as ServiceAdapter,
    accepted: {
      pathname: "/results",
      markup: "<ytd-video-renderer></ytd-video-renderer>",
    },
    rejected: {
      pathname: "/watch",
      markup: "<ytd-video-renderer></ytd-video-renderer>",
    },
  },
  {
    name: "ニコニコ動画",
    url: "https://www.nicovideo.jp/search/sift",
    adapter: ADAPTERS[3] as ServiceAdapter,
    accepted: {
      pathname: "/search/sift",
      markup:
        '<article data-video-id="sm1"><a href="/watch/sm1">Sift</a></article>',
    },
    rejected: {
      pathname: "/watch/sm1",
      markup:
        '<article data-video-id="sm1"><a href="/watch/sm1">Sift</a></article>',
    },
  },
];

describe("サイトと対象ページ", () => {
  it.each(PAGE_CASES)(
    "$name だけを対応サイトとして選ぶ",
    ({ url, adapter }) => {
      expect(selectAdapter(new URL(url).hostname)).toBe(adapter);
    },
  );

  it.each(PAGE_CASES)(
    "$name の対象ページだけでパネルを開ける",
    ({ adapter, accepted, rejected }) => {
      expect(
        adapter.isTimelineAvailable(render(accepted.markup), {
          pathname: accepted.pathname,
        }),
      ).toBe(true);
      expect(
        adapter.isTimelineAvailable(render(rejected.markup), {
          pathname: rejected.pathname,
        }),
      ).toBe(false);
    },
  );
});

describe("サイト別の設定項目", () => {
  it.each(["x", "bluesky"] as const)(
    "%s の反応数・メディア・返信・引用・リポスト設定を判定へ反映する",
    (site) => {
      expect(classifyWith(site, { minReactions: 1_001 })).toMatchObject({
        reason: "below-threshold",
      });
      expect(classifyWith(site, { minReactionsEnabled: false })).toMatchObject({
        reason: "no-inclusion-filter",
      });
      expect(
        classifyWith(
          site,
          { mediaEnabled: true, mediaMode: "images" },
          {
            mediaMatches: false,
          },
        ),
      ).toMatchObject({ reason: "no-media" });
      expect(
        classifyWith(site, { hideReplies: true }, { isReply: true }),
      ).toMatchObject({ reason: "reply" });
      expect(
        classifyWith(site, { hideQuotes: true }, { isQuote: true }),
      ).toMatchObject({ reason: "quote" });
      expect(
        classifyWith(site, { hideReposts: true }, { isRepost: true }),
      ).toMatchObject({ reason: "repost" });

      for (const mediaMode of ["any", "images", "video"] as const) {
        const settings = normalizeSettings({
          siteSettings: { [site]: { mediaEnabled: true, mediaMode } },
        });
        expect(settingsFor(settings, site).mediaMode).toBe(mediaMode);
      }
    },
  );

  it.each(["youtube", "niconico"] as const)(
    "%s の再生数・公開時期設定を判定へ反映する",
    (site) => {
      expect(classifyWith(site, { minCount: 1_001 })).toMatchObject({
        reason: "below-threshold",
      });
      expect(classifyWith(site, { minCountEnabled: false })).toMatchObject({
        reason: "no-inclusion-filter",
      });
      expect(
        classifyWith(
          site,
          {
            minCountEnabled: false,
            hidePublishedWithinEnabled: true,
            hidePublishedWithinValue: 2,
            hidePublishedWithinUnit: "day",
          },
          { createdAtMs: NOW - 47 * 3_600_000 },
        ),
      ).toMatchObject({ reason: "newer-than-period" });
      expect(
        classifyWith(site, {
          minCountEnabled: false,
          hidePublishedWithinEnabled: true,
          hidePublishedWithinValue: 2,
          hidePublishedWithinUnit: "day",
        }),
      ).toMatchObject({ reason: "filter-match" });
    },
  );
});
