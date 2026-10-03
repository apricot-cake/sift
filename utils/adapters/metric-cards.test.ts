import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FILTER_CONTEXT_METRIC_LIMIT,
  isFilterContextResponse,
} from "../filter-context.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { collectMetricCards } from "./metric-cards.ts";
import { niconicoAdapter } from "./niconico.ts";
import { xAdapter } from "./x.ts";
import { youtubeAdapter } from "./youtube.ts";

function root(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}
describe("上限付きの集計対象", () => {
  it.each([
    [xAdapter, "x-following"],
    [blueskyAdapter, "bluesky-home"],
    [youtubeAdapter, "youtube-channel-search"],
    [niconicoAdapter, "niconico-search"],
  ] as const)("%sの通常のカード集合を維持する", (adapter, fixture) => {
    const page = root(
      readFileSync(
        path.join(process.cwd(), "test/fixtures/adapters", `${fixture}.html`),
        "utf8",
      ),
    );
    const sample = adapter.getMetricPostCards(page);
    expect(sample.truncated).toBe(false);
    expect(new Set(sample.cards)).toEqual(new Set(adapter.getPostCards(page)));
  });
  it("全件NodeListを作らずカード数で打ち切る", () => {
    const page = root(
      "<article></article>".repeat(FILTER_CONTEXT_METRIC_LIMIT + 1),
    );
    const query = vi.spyOn(page, "querySelectorAll");
    const sample = collectMetricCards(page, (element) =>
      element.matches("article") ? element : null,
    );
    expect(sample.cards).toHaveLength(FILTER_CONTEXT_METRIC_LIMIT);
    expect(sample.truncated).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
  it("ちょうど上限で一覧が終わる場合は全件と判定する", () => {
    const page = root(
      "<article></article>".repeat(FILTER_CONTEXT_METRIC_LIMIT),
    );
    expect(collectMetricCards(page, (element) => element)).toMatchObject({
      truncated: false,
    });
  });
  it("カードでない要素も走査の上限に数える", () => {
    const page = root("<span></span>".repeat(10));
    const read = vi.fn(() => null);
    const sample = collectMetricCards(page, read, undefined, 4);
    expect(read).toHaveBeenCalledTimes(4);
    expect(sample).toEqual({ cards: [], truncated: true });
  });
  it("同じYouTubeセルの重複表示を数えない", () => {
    const page = root(
      "<ytd-rich-item-renderer><ytd-rich-grid-media></ytd-rich-grid-media><yt-lockup-view-model></yt-lockup-view-model></ytd-rich-item-renderer>",
    );
    expect(youtubeAdapter.getMetricPostCards(page).cards).toHaveLength(1);
  });
  it("引用・退避画面・不正な動画リンクの範囲を広げない", () => {
    expect(
      xAdapter.getMetricPostCards(
        root(
          '<article data-testid="tweet"><article data-testid="tweet"></article></article>',
        ),
      ).cards,
    ).toHaveLength(1);
    expect(
      blueskyAdapter.getMetricPostCards(
        root(
          '<div hidden><div data-testid="feedItem-by-a"><button data-testid="likeBtn"></button></div></div>',
        ),
      ).cards,
    ).toHaveLength(0);
    expect(
      niconicoAdapter.getMetricPostCards(
        root(
          '<article><a href="https://evil.example/watch/sm1">1</a></article>',
        ),
      ).cards,
    ).toHaveLength(0);
  });
  it("上限を超える応答や不正な範囲フラグを受け入れない", () => {
    const response = {
      site: "x",
      pageTitle: "x",
      pageKey: "x",
      timelineAvailable: true,
      filteringEnabled: false,
      continuousLoadingWarning: false,
      metricCounts: [1],
      metricCreatedAtMs: [],
      metricContextTruncated: true,
    };
    expect(isFilterContextResponse(response)).toBe(true);
    expect(
      isFilterContextResponse({ ...response, metricContextTruncated: "false" }),
    ).toBe(false);
    expect(
      isFilterContextResponse({
        ...response,
        metricCounts: Array(1001).fill(1),
      }),
    ).toBe(false);
    expect(
      isFilterContextResponse({
        ...response,
        metricCreatedAtMs: Array(1001).fill(1),
      }),
    ).toBe(false);
  });
});
