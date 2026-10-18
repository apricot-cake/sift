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
  timelineAvailable: true,
} as FilterContextResponse;
const page: PanelPage = {
  id: "open",
  url: context.pageKey,
  context: panelPageContext(context),
};
describe("開いた一覧を離れたかの判定", () => {
  it("一覧のパス・検索語・選択タブの変更を検知する", () => {
    for (const change of [
      { pageKey: "https://x.com/example" },
      { pageKey: "https://x.com/search?q=other&f=live" },
      { timelineKey: "/home:list-a" },
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
