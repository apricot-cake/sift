import { describe, expect, it } from "vitest";
import { render } from "../../test/dom.ts";
import {
  captureRoute,
  captureStructure,
  compareStructures,
  type StructureSnapshot,
} from "./structure.ts";

const snapshot = (html: string): StructureSnapshot => ({
  schema: 1,
  caseId: "x-profile",
  route: "/profile",
  regions: { card: [captureStructure(render(html))] },
});
describe("互換性検証の構造比較", () => {
  it("いいね済み状態だけの違いを構造変更に数えない", () => {
    expect(
      compareStructures(
        snapshot('<button data-testid="like"></button>'),
        snapshot('<button data-testid="unlike"></button>'),
      ),
    ).toEqual([]);
  });
  it("検索語や追跡引数ではなく並び順URLの変化を記録する", () => {
    expect(
      captureRoute("https://x.com/search?q=private&src=typed_query&f=live"),
    ).toBe("/search?f=live");
    expect(captureRoute("https://x.com/uowata94/media?filter=photo")).toBe(
      "/uowata94/media?filter=photo",
    );
    expect(captureRoute("https://x.com/search?q=other&f=top")).toBe(
      "/search?f=top",
    );
    expect(
      captureRoute(
        "https://www.nicovideo.jp/user/1/video?sortOrder=desc&sortKey=viewCount",
      ),
    ).toBe("/user/1/video?sortKey=viewCount&sortOrder=desc");
  });
  it("投稿本文・指標値・リンク先・動的ID・Sift属性は比較しない", () => {
    const first = snapshot(
      '<article id="random-a" data-sift-filter-state="hidden"><a href="/user/status/123">本文A</a><button aria-label="1 likes">1</button></article>',
    );
    const second = snapshot(
      '<article id="random-b"><a href="/other/status/456">本文B</a><button aria-label="200 likes">200</button></article>',
    );
    expect(compareStructures(first, second)).toEqual([]);
    expect(JSON.stringify(second)).not.toMatch(/本文|other|456|200/);
  });
  it("投稿日や指標の属性消失と操作要素の変更を検知する", () => {
    const before = snapshot(
      '<button role="combobox"></button><time datetime="2026-01-01"></time>',
    );
    const after = snapshot('<div role="listbox"></div><time></time>');
    expect(compareStructures(before, after)).toEqual([
      { region: "card", kind: "changed" },
    ]);
  });
  it("参照領域の消失と遷移先の変更を検知する", () => {
    const before = snapshot("<article></article>");
    expect(
      compareStructures(before, {
        ...before,
        route: "/new-profile",
        regions: {},
      }),
    ).toEqual([
      { region: "route", kind: "changed" },
      { region: "card", kind: "removed" },
    ]);
  });
  it("投稿者を含むtestidと反復件数を正規化する", () => {
    const before = snapshot('<div data-testid="feedItem-by-alice"></div>');
    const after = snapshot(
      '<div data-testid="feedItem-by-bob"></div><div data-testid="feedItem-by-charlie"></div>',
    );
    expect(compareStructures(before, after)).toEqual([]);
  });
});
