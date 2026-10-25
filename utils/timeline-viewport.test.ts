import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blueskyAdapter } from "./adapters/bluesky.ts";
import { xAdapter } from "./adapters/x.ts";
import { TimelineViewport } from "./timeline-viewport.ts";

let viewport: TimelineViewport;
let top: number;

function renderPost(state = "matched"): void {
  document.body.innerHTML = `<div data-testid="cellInnerDiv" data-sift-filter-state="${state}">
    <article data-testid="tweet"><a href="/example/status/123"><time datetime="2026-09-05T00:00:00Z"></time></a></article>
  </div>`;
  const cell = document.body.firstElementChild as HTMLElement;
  vi.spyOn(cell, "getBoundingClientRect").mockImplementation(() => ({
    top,
    bottom: top + 300,
    height: 300,
    left: 0,
    right: 500,
    width: 500,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/i/lists/42");
  top = -30;
  renderPost();
  vi.spyOn(window, "scrollBy").mockImplementation((...args: unknown[]) => {
    const options = args[0] as ScrollToOptions;
    top -= options.top ?? 0;
  });
  viewport = new TimelineViewport(xAdapter);
  viewport.update();
});

afterEach(() => {
  viewport.reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("X の一覧の位置復元", () => {
  it.each(["/i/lists/add_member", "/example/status/123/photo/1"])(
    "メニュー表示中の一時スクロールで %s からの復帰位置を上書きしない",
    (path) => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      document.body.append(menu);
      top = 470;
      viewport.update();
      vi.advanceTimersByTime(32);
      expect(window.scrollBy).not.toHaveBeenCalled();
      history.replaceState({}, "", path);
      menu.remove();
      viewport.syncRoute();
      history.replaceState({}, "", "/i/lists/42");
      viewport.update();
      vi.advanceTimersByTime(32);
      expect(top).toBe(-30);
    },
  );

  it("幅変更で DOM が作り直されても同じ投稿を同じ位置へ戻す", () => {
    viewport.resize();
    top = 270;
    renderPost();
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
    expect(window.scrollBy).toHaveBeenCalledWith({
      top: 300,
      behavior: "instant",
    });
    // 画像の読み込み後に高さが変わった場合も追従する。
    top = 70;
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
  });

  it("リスト選択画面では移動せず、元の一覧へ戻ってから復元する", () => {
    history.replaceState({}, "", "/i/lists/add_member");
    document.body.innerHTML = "";
    viewport.update();
    vi.advanceTimersByTime(100);
    expect(window.scrollBy).not.toHaveBeenCalled();
    history.replaceState({}, "", "/i/lists/42");
    top = 470;
    renderPost();
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
  });

  it("別のリストへ移動したときは同じ投稿があっても古い位置を使わない", () => {
    history.replaceState({}, "", "/i/lists/add_member");
    viewport.update();
    history.replaceState({}, "", "/i/lists/43");
    top = 200;
    renderPost();
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("二つのリストを往復しても、それぞれの投稿位置を復元する", () => {
    history.replaceState({}, "", "/i/lists/43");
    top = 200;
    renderPost();
    viewport.update();
    history.replaceState({}, "", "/i/lists/42");
    top = 400;
    renderPost();
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
    history.replaceState({}, "", "/i/lists/43");
    top = 500;
    renderPost();
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(200);
  });

  it("明示的な停止で、他のリストの保存位置も破棄する", () => {
    history.replaceState({}, "", "/i/lists/43");
    top = 200;
    renderPost();
    viewport.update();
    viewport.reset();
    history.replaceState({}, "", "/i/lists/42");
    top = 400;
    renderPost();
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("ホーム内の固定リストをURLが変わらなくても区別して復元する", () => {
    viewport.reset();
    history.replaceState({}, "", "/home");
    const tabs = document.createElement("div");
    tabs.setAttribute("role", "tablist");
    tabs.dataset.testid = "ScrollSnap-List";
    tabs.innerHTML = `<button role="tab">おすすめ</button>
      <button role="tab">フォロー中</button>
      <button role="tab" aria-selected="true">リストA</button>
      <button role="tab" aria-selected="false">リストB</button>`;
    document.body.prepend(tabs);
    const select = (index: number) => {
      for (const [i, tab] of Array.from(tabs.children).entries()) {
        tab.setAttribute("aria-selected", String(i === index));
      }
    };
    viewport.update();
    select(3);
    top = 120;
    viewport.update();
    select(2);
    top = 450;
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
    select(3);
    top = 500;
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(120);
  });

  it("投稿が戻るのを待ち、フィルター適用前の座標を使わない", () => {
    viewport.resize();
    document.body.innerHTML = "";
    vi.advanceTimersByTime(32);
    top = 500;
    renderPost("");
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
    (document.body.firstElementChild as HTMLElement).dataset.siftFilterState =
      "matched";
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
  });

  it("ユーザーがスクロールしたら復元を中止する", () => {
    viewport.resize();
    viewport.cancel();
    top = 200;
    viewport.update();
    vi.advanceTimersByTime(100);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "メニュー復帰の通知前の閲覧操作で古い位置へ戻さない（メニュー表示中: %s）",
    (menuStillOpen) => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      document.body.append(menu);
      viewport.syncRoute();
      top = 470;
      if (!menuStillOpen) menu.remove();
      viewport.cancelForUserNavigation();
      menu.remove();
      viewport.update();
      vi.advanceTimersByTime(2_100);
      expect(top).toBe(470);
      expect(window.scrollBy).not.toHaveBeenCalled();
      expect(viewport.isRestoring()).toBe(false);
    },
  );

  it("一覧上の入力の後に開いたメニューからは元の位置へ復元する", () => {
    viewport.cancelForUserNavigation();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    top = 470;
    viewport.update();
    menu.remove();
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
  });

  it("メニュー内の入力後に別画面へ移動して戻れば元の位置へ復元する", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    top = 470;
    viewport.cancelForUserNavigation();
    history.replaceState({}, "", "/i/lists/add_member");
    viewport.syncRoute();
    menu.remove();
    history.replaceState({}, "", "/i/lists/42");
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
  });

  it("幅変更の通知前に閲覧操作をしたら次のスクロール通知で復元しない", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(572);
    top = 200;
    viewport.cancelForUserNavigation();
    viewport.update();
    vi.advanceTimersByTime(2_100);
    expect(top).toBe(200);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("戻り先URLの一覧が未描画でも閲覧操作を記憶し、描画後に復元しない", () => {
    function addHomeTabs(): void {
      const tabs = document.createElement("div");
      tabs.dataset.testid = "ScrollSnap-List";
      tabs.setAttribute("role", "tablist");
      tabs.innerHTML =
        '<button role="tab">おすすめ</button><button role="tab" aria-selected="true">フォロー中</button>';
      document.body.prepend(tabs);
    }
    viewport.reset();
    history.replaceState({}, "", "/home");
    addHomeTabs();
    viewport.update();
    history.replaceState({}, "", "/example/status/123");
    viewport.syncRoute();
    history.replaceState({}, "", "/home");
    renderPost();
    top = 200;
    viewport.cancelForUserNavigation();
    // 遷移中の監視が繰り返されても、入力の記録を消さない。
    viewport.update();
    vi.advanceTimersByTime(32);
    addHomeTabs();
    viewport.update();
    vi.advanceTimersByTime(2_100);
    expect(top).toBe(200);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("投稿詳細での閲覧操作は戻り先の一覧の保存位置を消さない", () => {
    history.replaceState({}, "", "/example/status/123");
    top = 200;
    viewport.cancelForUserNavigation();
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
    history.replaceState({}, "", "/i/lists/42");
    top = 470;
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
  });

  it("リスト復帰の通知前の閲覧操作は他のリストの保存位置を維持する", () => {
    history.replaceState({}, "", "/i/lists/43");
    top = 100;
    viewport.update();
    history.replaceState({}, "", "/i/lists/42");
    top = 200;
    viewport.cancelForUserNavigation();
    viewport.update();
    vi.advanceTimersByTime(2_100);
    expect(top).toBe(200);
    expect(window.scrollBy).not.toHaveBeenCalled();
    history.replaceState({}, "", "/i/lists/43");
    top = 500;
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(100);
    history.replaceState({}, "", "/i/lists/42");
    top = 500;
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(200);
  });

  it("復元の終了後は投稿の位置を固定し続けない", () => {
    viewport.resize();
    vi.advanceTimersByTime(2_100);
    top = 100;
    vi.advanceTimersByTime(100);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});

describe("パネルを開くときの未抽出ページの位置復元", () => {
  beforeEach(() => {
    vi.spyOn(document, "elementFromPoint").mockImplementation((x, y) => {
      for (const cell of document.querySelectorAll(
        '[data-testid="cellInnerDiv"]',
      )) {
        const rect = cell.getBoundingClientRect();
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        )
          return cell.querySelector("article");
      }
      return null;
    });
  });

  function renderHome(state?: string): void {
    renderPost(state ?? "");
    if (state === undefined)
      document.body.firstElementChild?.removeAttribute(
        "data-sift-filter-state",
      );
    const tabs = document.createElement("div");
    tabs.dataset.testid = "ScrollSnap-List";
    tabs.setAttribute("role", "tablist");
    tabs.innerHTML =
      '<button role="tab" aria-selected="true">おすすめ</button><button role="tab" aria-selected="false">フォロー中</button>';
    document.body.prepend(tabs);
  }

  function prepare(unfiltered = true): void {
    viewport.reset();
    history.replaceState({}, "", "/home");
    renderHome();
    viewport = new TimelineViewport(xAdapter, { unfiltered });
    viewport.update();
  }

  it("おすすめの投稿が幅変更で作り直されても実投稿IDで同じ位置へ戻す", () => {
    prepare();
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(xAdapter.isTimelineAvailable(document, location)).toBe(false);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(558);
    top = 154;
    renderHome();
    viewport.resize();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
    expect(window.scrollBy).toHaveBeenCalledWith({
      top: 184,
      behavior: "instant",
    });
    expect(document.querySelector("[data-sift-filter-state]")).toBeNull();
  });

  it("既定の抽出用設定では対象外ページを復元しない", () => {
    prepare(false);
    viewport.resize();
    top = 154;
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(top).toBe(154);
  });

  it("ヘッダーに隠れた前の投稿を除き、実際に見える投稿の位置を戻す", () => {
    prepare();
    viewport.reset();
    top = 19;
    let previousTop = -140;
    const previous = document.createElement("div");
    previous.dataset.testid = "cellInnerDiv";
    previous.innerHTML =
      '<article data-testid="tweet"><a href="/example/status/456"><time datetime="2026-09-05T00:00:00Z"></time></a></article>';
    document.body.prepend(previous);
    vi.spyOn(previous, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, previousTop, 500, 160),
    );
    const visibleCard = document
      .querySelector('a[href="/example/status/123"]')
      ?.closest("article");
    const header = document.createElement("header");
    document.body.prepend(header);
    vi.mocked(document.elementFromPoint).mockImplementation((_x, y) =>
      y < 130 ? header : (visibleCard ?? null),
    );
    vi.mocked(window.scrollBy).mockImplementation((...args: unknown[]) => {
      const offset = (args[0] as ScrollToOptions).top ?? 0;
      top -= offset;
      previousTop -= offset;
    });
    viewport.update();
    // 幅変更で二つの投稿の高さが異なる量だけ変わる。
    previousTop = -38;
    top = 203;
    viewport.resize();
    vi.advanceTimersByTime(32);
    expect(top).toBe(19);
    expect(window.scrollBy).toHaveBeenCalledWith({
      top: 184,
      behavior: "instant",
    });
  });

  it("同じ投稿IDがない場合や非表示の投稿は位置の根拠にしない", () => {
    prepare();
    viewport.resize();
    top = 154;
    document.querySelector("a")?.setAttribute("href", "/example/status/456");
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
    renderHome("hidden");
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
    renderHome();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
  });

  it("別の対象外ページへ移動したら以前の投稿位置へ戻さない", () => {
    prepare();
    viewport.resize();
    history.replaceState({}, "", "/example/status/123");
    top = 154;
    vi.advanceTimersByTime(2_100);
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(top).toBe(154);
  });

  it("閲覧操作で中断した後は元の位置へ戻さない", () => {
    prepare();
    viewport.resize();
    top = 154;
    viewport.cancelForUserNavigation();
    viewport.update();
    vi.advanceTimersByTime(2_100);
    expect(window.scrollBy).not.toHaveBeenCalled();
    expect(top).toBe(154);
  });
});

it("Bluesky のホーム内で切り替えたリストを区別する", () => {
  document.body.innerHTML =
    '<button data-testid="homeScreenFeedTabs-selector-1">リスト1<span style="background-color: blue"></span></button><button data-testid="homeScreenFeedTabs-selector-2">リスト2</button>';
  const page = { pathname: "/", search: "" };
  const first = blueskyAdapter.readTimelineKey(document, page);
  document.body.lastElementChild?.append(
    document.querySelector("span") as HTMLElement,
  );
  expect(blueskyAdapter.readTimelineKey(document, page)).not.toBe(first);
});

it("Bluesky の投稿詳細でスクロールしても、戻ったリストの位置を復元する", () => {
  viewport.reset();
  const list = "/profile/example.test/lists/42";
  history.replaceState({}, "", list);
  document.body.innerHTML =
    '<div data-testid="feedItem-by-example.test" data-sift-filter-state="matched"><a href="/profile/example.test/post/123">投稿</a><button data-testid="likeBtn"></button></div>';
  const card = document.body.firstElementChild as HTMLElement;
  vi.spyOn(card, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, top, 500, 300),
  );
  viewport = new TimelineViewport(blueskyAdapter);
  viewport.update();

  // SPA が背後のホームを追加・除去しても、リストの識別は変わらない。
  const homeTab = document.createElement("button");
  homeTab.dataset.testid = "homeScreenFeedTabs-selector-1";
  homeTab.innerHTML = 'ホーム<span style="background-color: blue"></span>';
  document.body.append(homeTab);
  viewport.update();

  history.replaceState({}, "", "/profile/example.test/post/123");
  card.dataset.testid = "postThreadItem-by-example.test";
  top = 200;
  // 次ページ確認の一時スクロール中は、座標を記録せず遷移だけを追跡する。
  viewport.syncRoute();
  vi.advanceTimersByTime(3_000);
  top = -100;
  viewport.syncRoute();
  expect(window.scrollBy).not.toHaveBeenCalled();

  history.replaceState({}, "", list);
  homeTab.remove();
  card.dataset.testid = "feedItem-by-example.test";
  top = 500;
  viewport.update();
  vi.advanceTimersByTime(32);
  expect(top).toBe(-30);
});

describe.each([
  {
    name: "Bluesky",
    adapter: blueskyAdapter,
    path: "/profile/example.test",
    nextPath: "/profile/other.test",
    markup:
      '<div data-testid="feedItem-by-example.test" data-sift-filter-state="matched"><a href="/profile/example.test/post/123">投稿</a><button data-testid="likeBtn"></button></div>',
  },
])("$name の位置復元", ({ adapter, path, nextPath, markup }) => {
  function prepare(): void {
    viewport.reset();
    history.replaceState({}, "", path);
    document.body.innerHTML = markup;
    vi.spyOn(
      document.body.firstElementChild as HTMLElement,
      "getBoundingClientRect",
    ).mockImplementation(() => new DOMRect(0, top, 500, 300));
    viewport = new TimelineViewport(adapter);
    viewport.update();
  }

  it("サイズ変更後のスクロール通知でも変更前の位置を失わない", () => {
    prepare();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(572);
    top = 600;
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(-30);
    viewport.cancel();
    top = 50;
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(top).toBe(50);
  });

  it("別の一覧や検索条件には以前の位置を復元しない", () => {
    prepare();
    viewport.resize();
    history.replaceState({}, "", nextPath);
    top = 250;
    viewport.update();
    vi.advanceTimersByTime(32);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});
