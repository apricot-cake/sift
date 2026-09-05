import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blueskyAdapter } from "./adapters/bluesky.ts";
import { xAdapter } from "./adapters/x.ts";
import { youtubeAdapter } from "./adapters/youtube.ts";
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

  it("復元の終了後は投稿の位置を固定し続けない", () => {
    viewport.resize();
    vi.advanceTimersByTime(2_100);
    top = 100;
    vi.advanceTimersByTime(100);
    expect(window.scrollBy).not.toHaveBeenCalled();
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
  {
    name: "YouTube",
    adapter: youtubeAdapter,
    path: "/results?search_query=music",
    nextPath: "/results?search_query=news",
    markup:
      '<ytd-video-renderer data-sift-filter-state="matched"><a id="video-title" href="/watch?v=123">動画</a></ytd-video-renderer>',
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
