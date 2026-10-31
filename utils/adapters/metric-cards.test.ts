import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FILTER_CONTEXT_METRIC_LIMIT,
  isFilterContextResponse,
} from "../filter-context.ts";
import { blueskyAdapter } from "./bluesky.ts";
import { collectMetricCards } from "./metric-cards.ts";
import { xAdapter } from "./x.ts";

function root(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}
describe("上限付きの集計対象", () => {
  it.each([
    [xAdapter, "x-following"],
    [blueskyAdapter, "bluesky-home"],
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
  it("引用と退避画面の範囲を広げない", () => {
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
  });
  it("一覧の識別子がない応答を受け入れ、不正な識別子を拒否する", () => {
    const response = {
      site: "x",
      pageTitle: "x",
      pageKey: "x",
      timelineAvailable: true,
      posts: [],
      collectedCount: 1,
      collectionTruncated: false,
    };
    expect(isFilterContextResponse(response)).toBe(true);
    expect(
      isFilterContextResponse({
        ...response,
        timelineKey: "/home:1:Following",
      }),
    ).toBe(true);
    expect(isFilterContextResponse({ ...response, timelineKey: null })).toBe(
      true,
    );
    expect(isFilterContextResponse({ ...response, timelineKey: 1 })).toBe(
      false,
    );
    expect(isFilterContextResponse({ ...response, timelineKey: {} })).toBe(
      false,
    );
  });
});
