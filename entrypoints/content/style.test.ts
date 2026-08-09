import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// DOM を通して動かさず、ディスクから読む＝ここの主張は「スタイルシートが何を
// 名指ししてよいか」についてのもので、それはどう描いても見えない。
//
// 起点はプロジェクトの根＝Vitest が走るのはそこ。短い経路は2つともふさがって
// いる＝Vitest はモジュールを http で配るのでここでは `import.meta.url` が
// http の URL になるし、Vite の `?raw` は CSS の処理を通った後のスタイルシートに
// 空の文字列を返す＝それは何も読まないまま通るテスト。
function readFromRoot(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const contentStyles = readFromRoot("entrypoints/content/style.css");
const contentScript = readFromRoot("entrypoints/content/index.ts");

describe("content のスタイルシート", () => {
  // そうしないと、強調は CSS がたまたま名指ししたサービスにだけ出るし
  // （かつては X の投稿カードを名指ししていて、線が引かれるのは X だけだった）、
  // アダプターが増えるたびにここへ規則を足すことになる。
  it("どのサービスの画面の作りも名指ししない", () => {
    for (const serviceSpecific of [
      "data-testid",
      "tweet",
      "feedItem",
      "bsky",
      "article",
    ]) {
      expect(
        contentStyles.includes(serviceSpecific),
        `entrypoints/content/style.css が ${serviceSpecific} を名指ししている＝これは1つのサービスの画面の作り`,
      ).toBe(false);
    }
  });

  // どちらの強調も状態の属性だけを手掛かりにしているので、どのアダプターが
  // 印を付けたセルにも当たる。
  it("それぞれの強調を、状態を持つセルに描く", () => {
    for (const state of ["hit", "rising"]) {
      expect(
        contentStyles,
        `entrypoints/content/style.css に、${state} のセル自身に当たる規則が無い`,
      ).toMatch(new RegExp(`\\[data-sift-filter-state="${state}"\\]\\s*\\{`));
    }
  });
});

describe("content script がページへ書き込むもの", () => {
  // 拡張機能が Sift へ改名されたのはこれらのテストができるより前で、content
  // script が書き込む属性とクラス名が、古い接頭辞の生き残った最後の場所だった。
  // これらは外から見える面＝読み手自身の CSS も、同じページの他の拡張機能も
  // 見られるので、行の写し間違いで古い名前が戻ってきてはならない。
  it("拡張機能の古い名前の痕跡を持たない", () => {
    expect(contentStyles).not.toContain("xif");
    expect(contentScript).not.toContain("xif");
  });
});
