import { describe, expect, it } from "vitest";
import {
  directInitializationCaseIds,
  groupByEntry,
  liveCasePriority,
} from "../e2e/cases.ts";
import { createCompatibilityCases } from "../e2e/compatibility.cases.ts";
import { createEmptyCases } from "../e2e/empty.cases.ts";
import { createLifecycleCases } from "../e2e/lifecycle.cases.ts";
import { createLightboxCases } from "../e2e/lightbox.cases.ts";
import { createUnsupportedCases } from "../e2e/unsupported.cases.ts";

const cases = [
  ...createCompatibilityCases(),
  ...createLifecycleCases(),
  ...createUnsupportedCases(),
  ...createEmptyCases(),
  ...createLightboxCases(),
];
const plan = groupByEntry(
  cases,
  (item) => item.entry,
  (item) => liveCasePriority(item.id),
);

describe("実機検証のページ共有計画", () => {
  it("直接アクセスの補完は既存の代表2件に限定する", () => {
    expect(directInitializationCaseIds).toEqual([
      "unsupported-niconico-search-oldest",
      "unsupported-empty-youtube-channel-search",
    ]);
    for (const id of directInitializationCaseIds)
      expect(plan.filter((item) => item.id === id)).toHaveLength(1);
  });
  it("並べ替えても57件の個別ケースを重複・脱落させない", () => {
    expect(cases).toHaveLength(57);
    expect(new Set(plan.map((item) => item.id)).size).toBe(57);
    expect(plan.map((item) => item.id).sort()).toEqual(
      cases.map((item) => item.id).sort(),
    );
    const keys = plan.map((item) => item.entry);
    const contiguous = keys.filter((key, index) => key !== keys[index - 1]);
    expect(new Set(contiguous).size).toBe(contiguous.length);
  });
  it("既定順を推測で復元せず、検索共有の先頭で確認する", () => {
    const search = plan.filter(
      (item) =>
        item.id.startsWith("unsupported-niconico-search-") &&
        !item.id.includes("tag"),
    );
    expect(new Set(search.map((item) => item.entry)).size).toBe(1);
    expect(search[0]?.id).toBe("unsupported-niconico-search-default");
    expect(search.findIndex((item) => item.id.endsWith("newest"))).toBeLessThan(
      search.findIndex((item) => item.id.endsWith("oldest")),
    );
  });
  it("同じ検索ページとホームだけを共用し、別の対象は混ぜない", () => {
    const entry = (id: string) => cases.find((item) => item.id === id)?.entry;
    expect(entry("x-search")).toBe(entry("x-reply-representative"));
    expect(entry("x-search")).toBe(entry("empty-x-search"));
    expect(entry("bluesky-following")).toBe(entry("bluesky-list"));
    expect(entry("unsupported-youtube-channel-search")).toBe(
      entry("unsupported-empty-youtube-channel-search"),
    );
    expect(entry("unsupported-youtube-channel-search")).not.toBe(
      entry("youtube-chip-popular"),
    );
    expect(entry("unsupported-niconico-tag")).not.toBe(
      entry("unsupported-niconico-search-default"),
    );
  });
});
