import { describe, expect, it } from "vitest";
import { groupByEntry } from "../e2e/cases.ts";
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
const plan = groupByEntry(cases, (item) => item.entry);

describe("実機検証のページ共有計画", () => {
  it("並べ替えても29件の個別ケースを重複・脱落させない", () => {
    expect(cases).toHaveLength(29);
    expect(new Set(plan.map((item) => item.id)).size).toBe(29);
    expect(plan.map((item) => item.id).sort()).toEqual(
      cases.map((item) => item.id).sort(),
    );
    const keys = plan.map((item) => item.entry);
    const contiguous = keys.filter((key, index) => key !== keys[index - 1]);
    expect(new Set(contiguous).size).toBe(contiguous.length);
  });
  it("同じ検索ページとホームだけを共用し、別の対象は混ぜない", () => {
    const entry = (id: string) => cases.find((item) => item.id === id)?.entry;
    expect(entry("x-search")).toBe(entry("x-reply-representative"));
    expect(entry("x-search")).toBe(entry("empty-x-search"));
    expect(entry("bluesky-following")).toBe(entry("bluesky-list"));
  });
});
