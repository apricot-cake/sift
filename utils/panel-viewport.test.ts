import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { xAdapter } from "./adapters/x.ts";
import { PanelViewport } from "./panel-viewport.ts";

let viewport: PanelViewport;
let top: number;
function render(id = "123"): void {
  document.body.innerHTML = `<div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/example/status/${id}"><time datetime="2026-10-25T00:00:00Z">時刻</time></a></article></div>`;
  const cell = document.body.firstElementChild as HTMLElement;
  vi.spyOn(cell, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, top, 500, 300),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/i/lists/42");
  top = 31;
  render();
  vi.spyOn(document, "elementFromPoint").mockImplementation(() =>
    document.querySelector("article"),
  );
  vi.spyOn(window, "scrollBy").mockImplementation((...args: unknown[]) => {
    top -= (args[0] as ScrollToOptions).top ?? 0;
  });
  viewport = new PanelViewport(xAdapter);
  viewport.capture();
});
afterEach(() => {
  viewport.cancel();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("パネルを開くときの幅変更と閲覧位置", () => {
  it("投稿情報の取得だけではスクロールやDOMを変更しない", () => {
    const html = document.body.innerHTML;
    viewport.capture();
    vi.advanceTimersByTime(3000);
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(html);
  });
  it("幅変更で投稿が再描画されても同じIDを同じ位置へ戻す", () => {
    top = 215;
    render();
    viewport.resize();
    vi.advanceTimersByTime(32);
    expect(top).toBe(31);
    expect(window.scrollBy).toHaveBeenCalledWith({
      top: 184,
      behavior: "instant",
    });
    top = 75;
    vi.advanceTimersByTime(32);
    expect(top).toBe(31);
  });
  it("対象外のおすすめでも実際に読んでいた投稿を保つ", () => {
    history.replaceState({}, "", "/home");
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div data-testid="ScrollSnap-List" role="tablist"><div role="tab" aria-selected="true">おすすめ</div><div role="tab">フォロー中</div></div>',
    );
    viewport = new PanelViewport(xAdapter);
    viewport.capture();
    top = 215;
    viewport.resize();
    vi.advanceTimersByTime(32);
    expect(xAdapter.isTimelineAvailable(document, location)).toBe(false);
    expect(top).toBe(31);
  });
  it("固定ヘッダーの裏にある前の投稿を位置の基準にしない", () => {
    let previousTop = -140;
    top = 19;
    const cell = document.createElement("div");
    cell.innerHTML =
      '<article data-testid="tweet"><a href="/example/status/456"><time datetime="2026-10-25T00:00:00Z">時刻</time></a></article>';
    cell.dataset.testid = "cellInnerDiv";
    document.body.prepend(cell);
    vi.spyOn(cell, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, previousTop, 500, 160),
    );
    const visible = document
      .querySelector('a[href="/example/status/123"]')
      ?.closest("article");
    const header = document.createElement("header");
    vi.mocked(document.elementFromPoint).mockImplementation((_x, y) =>
      y < 130 ? header : (visible ?? null),
    );
    vi.mocked(window.scrollBy).mockImplementation((...args: unknown[]) => {
      const offset = (args[0] as ScrollToOptions).top ?? 0;
      top -= offset;
      previousTop -= offset;
    });
    viewport.capture();
    previousTop = -38;
    top = 203;
    viewport.resize();
    vi.advanceTimersByTime(32);
    expect(top).toBe(19);
  });
  it("同じIDが描画されるまで待ち、別投稿の位置へ動かさない", () => {
    top = 215;
    render("456");
    viewport.resize();
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
    render("123");
    vi.advanceTimersByTime(32);
    expect(top).toBe(31);
  });
  it("ページや一覧タブを移動した後は以前の位置へ戻さない", () => {
    viewport.resize();
    top = 215;
    history.replaceState({}, "", "/i/lists/43");
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
    history.replaceState({}, "", "/i/lists/42");
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
  it("利用者の操作によるキャンセルと復元期限を守る", () => {
    viewport.resize();
    top = 215;
    viewport.cancel();
    vi.advanceTimersByTime(32);
    expect(top).toBe(215);
    viewport.resize();
    vi.advanceTimersByTime(2100);
    top = 215;
    vi.advanceTimersByTime(1000);
    expect(top).toBe(215);
  });
});
