import { describe, expect, it } from "vitest";
import type { FilterContextResponse } from "./filter-context.ts";
import {
  hasLeftPanelPage,
  type PanelPage,
  panelPageContext,
  panelPageUrl,
} from "./panel-navigation.ts";

const context = {
  pageKey: "https://x.com/home",
  timelineKey: "/home:Following",
  sortOrder: "newest",
  timelineAvailable: true,
} as FilterContextResponse;
const page: PanelPage = {
  id: "open",
  url: context.pageKey,
  context: panelPageContext(context),
};
describe("開いた一覧を離れたかの判定", () => {
  it("ニコニコ検索の計測項目除去では維持し、並び順の変更では閉じる", () => {
    const pageKey =
      "https://www.nicovideo.jp/search/test?sort=registeredAt&order=asc&rd=sort&rf=nvpc&rp=search";
    const opening = {
      ...page,
      context: { ...context, pageKey, timelineKey: null },
    };
    const current = {
      ...context,
      pageKey:
        "https://www.nicovideo.jp/search/test?order=asc&sort=registeredAt",
      timelineKey: null,
    };
    expect(hasLeftPanelPage(opening, current)).toBe(false);
    expect(
      hasLeftPanelPage(opening, {
        ...current,
        pageKey: current.pageKey.replace("asc", "desc"),
      }),
    ).toBe(true);
  });
  it("一覧のパス・検索語・選択タブ・並び順の変更を検知する", () => {
    for (const change of [
      { pageKey: "https://x.com/example" },
      { pageKey: "https://x.com/search?q=other&f=live" },
      { timelineKey: "/home:list-a" },
      { sortOrder: "popular" as const },
    ])
      expect(hasLeftPanelPage(page, { ...context, ...change })).toBe(true);
  });
  it("画像表示中のnullキーと一時的な描画待ちでは閉じない", () => {
    expect(hasLeftPanelPage(page, { ...context, timelineKey: null })).toBe(
      false,
    );
    expect(
      hasLeftPanelPage(page, {
        ...context,
        timelineKey: null,
        timelineAvailable: false,
        health: {
          state: "loading",
          sampledPosts: 0,
          readableMetrics: 0,
          readableDates: 0,
        },
      }),
    ).toBe(false);
    expect(
      hasLeftPanelPage(page, {
        ...context,
        timelineKey: null,
        timelineAvailable: false,
        health: {
          state: "unsupported",
          sampledPosts: 0,
          readableMetrics: 0,
          readableDates: 0,
        },
      }),
    ).toBe(true);
  });
  it("元の一覧に戻る操作や同じURLの再読み込みでは変化としない", () => {
    expect(hasLeftPanelPage(page, context)).toBe(false);
    expect(panelPageUrl("https://x.com/home#position")).toBe(
      "https://x.com/home",
    );
  });
});
