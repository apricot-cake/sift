import { describe, expect, it } from "vitest";
import { type ClassifyThresholds, classifyPost } from "./filter-core.ts";
import { hasRetainedPostBelowViewport } from "./layout-probe.ts";

const settings: ClassifyThresholds = {
  hideReplies: true,
  hideQuotes: false,
  hideReposts: false,
  inclusion: { minimum: null },
  mediaEnabled: false,
};
const post = {
  mediaMatches: true,
  metricCount: 10,
  createdAtMs: Number.NaN,
  isReply: false,
  isQuote: false,
  isRepost: false,
};
const cell = (bottom: number) => ({
  getBoundingClientRect: () => ({ bottom }) as DOMRect,
});

describe("追加取得のためのレイアウト確認", () => {
  it("種別条件だけで残した投稿が画面下にあれば追加取得を要求しない", () => {
    const result = classifyPost(post, settings);
    expect(result.state).toBe("visible");
    expect(
      hasRetainedPostBelowViewport(
        [{ cell: cell(900), state: result.state }],
        800,
      ),
    ).toBe(true);
  });
  it("指標を読めず安全のため残した投稿も、空き領域とは扱わない", () => {
    const result = classifyPost(
      { ...post, metricCount: Number.NaN },
      { ...settings, inclusion: { minimum: 100 } },
    );
    expect(result.state).toBe("visible");
    expect(
      hasRetainedPostBelowViewport(
        [{ cell: cell(900), state: result.state }],
        800,
      ),
    ).toBe(true);
  });
  it("一致した投稿は数え、除外した投稿や上方の投稿は数えない", () => {
    const matched = classifyPost(post, {
      ...settings,
      inclusion: { minimum: 5 },
    });
    const hidden = classifyPost({ ...post, isReply: true }, settings);
    expect(
      hasRetainedPostBelowViewport(
        [{ cell: cell(900), state: matched.state }],
        800,
      ),
    ).toBe(true);
    expect(
      hasRetainedPostBelowViewport(
        [
          { cell: cell(900), state: hidden.state },
          { cell: cell(804), state: matched.state },
        ],
        800,
      ),
    ).toBe(false);
  });
});
