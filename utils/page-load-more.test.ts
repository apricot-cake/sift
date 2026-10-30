import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blueskyAdapter } from "./adapters/bluesky.ts";
import { xAdapter } from "./adapters/x.ts";
import { PageLoadMore, pageLoadBlockReason } from "./page-load-more.ts";
import {
  isLoadMoreRequest,
  isLoadMoreResponse,
  PANEL_LOAD_MORE,
} from "./panel-load-more.ts";

function post(id: string): string {
  return `<div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/example/status/${id}"><time datetime="2026-10-25T00:00:00Z"></time></a><div data-testid="tweetText">投稿${id}</div><button data-testid="like" aria-label="100 likes"></button></article></div>`;
}

let y = 100;
let scroll: ReturnType<typeof vi.fn<(options: ScrollToOptions) => void>>;
let collected: Set<string>;

function collect(): number {
  for (const card of xAdapter.getPostCards(document)) {
    const id = xAdapter.readPostId(card);
    if (id) collected.add(id);
  }
  return collected.size;
}

function run(signal = new AbortController().signal, isCurrent = () => true) {
  return new PageLoadMore().run({
    adapter: xAdapter,
    signal,
    isCurrent,
    collect,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/i/lists/42");
  document.body.innerHTML = post("1");
  y = 100;
  collected = new Set();
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const top = this.matches('[data-testid="cellInnerDiv"]') ? 120 - y : 20;
      return {
        top,
        bottom: top + 300,
        height: 300,
        width: 500,
        left: 0,
        right: 500,
        x: 0,
        y: top,
        toJSON() {},
      };
    },
  );
  scroll = vi.fn((options: ScrollToOptions) => {
    y = options.top ?? y;
  });
  vi.spyOn(window, "scrollTo").mockImplementation(
    scroll as typeof window.scrollTo,
  );
  vi.spyOn(window, "scrollBy").mockImplementation(((
    options: ScrollToOptions,
  ) => {
    y += options.top ?? 0;
  }) as typeof window.scrollBy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("一覧の1回分の追加読み込み", () => {
  it("戻す前に収集し、仮想DOMから消えても追加投稿を保持する", async () => {
    scroll.mockImplementation((options) => {
      y = typeof options === "object" ? (options.top ?? y) : y;
      document.body.innerHTML = y > 100 ? post("1") + post("2") : post("1");
    });
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 1 });
    expect([...collected]).toEqual(["1", "2"]);
    expect(document.querySelectorAll("article")).toHaveLength(1);
    expect(y).toBe(100);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("新しい投稿がなくても追加スクロールを繰り返さず、時間上限で戻る", async () => {
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "no-progress", added: 0 });
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(y).toBe(100);
  });

  it("同じ一覧でのキャンセルは、先へ進んだ画面を元の位置へ戻す", async () => {
    const controller = new AbortController();
    const result = run(controller.signal);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "cancelled", added: 0 });
    expect(y).toBe(100);
  });

  it("移動先の一覧へ古い座標を適用しない", async () => {
    let current = true;
    const result = run(undefined, () => current);
    current = false;
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "cancelled", added: 0 });
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("元ページでユーザーが操作したら、その操作後の位置を上書きしない", async () => {
    const result = run();
    const input = new Event("wheel");
    Object.defineProperty(input, "isTrusted", { value: true });
    window.dispatchEvent(input);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: "cancelled" });
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("位置を照合できなくなったら復元失敗として返す", async () => {
    scroll.mockImplementation((options) => {
      y = typeof options === "object" ? (options.top ?? y) : y;
      document.body.innerHTML = post("2");
    });
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "restore-failed", added: 1 });
  });

  it("一度復元できても、最後の待機中に基準投稿が消えたら成功にしない", async () => {
    scroll.mockImplementation((options) => {
      y = options.top ?? y;
      document.body.innerHTML = y > 100 ? post("1") + post("2") : post("1");
    });
    const result = run();
    setTimeout(() => {
      document.body.innerHTML = "";
    }, 1300);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "restore-failed", added: 1 });
  });

  it("サイトの制限表示を検出したら取得前に停止する", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="alert">Rate limit exceeded</div>',
    );
    expect(await run()).toEqual({ status: "limited", added: 0 });
    expect(scroll).not.toHaveBeenCalled();
  });

  it("通常の投稿に含まれるログインや制限の文言は停止理由にしない", () => {
    const text = document.querySelector('[data-testid="tweetText"]');
    if (text) text.textContent = "ログイン画面の説明。Rate limit exceeded";
    expect(pageLoadBlockReason(document)).toBeNull();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="dialog">Log in to X</div>',
    );
    expect(pageLoadBlockReason(document)).toBe("authentication");
  });

  it("途中で制限が出たら追加取得を止め、元位置へ戻す", async () => {
    const result = run();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="alert">You are rate limited</div>',
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "limited", added: 0 });
    expect(y).toBe(100);
  });

  it("収集で例外が発生しても、同じ一覧なら位置を戻して失敗を返す", async () => {
    const failingCollect = vi
      .fn()
      .mockReturnValueOnce(1)
      .mockImplementation(() => {
        throw new Error("DOMが差し替わった");
      });
    const result = new PageLoadMore().run({
      adapter: xAdapter,
      signal: new AbortController().signal,
      isCurrent: () => true,
      collect: failingCollect,
    });
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "failed", added: 0 });
    expect(y).toBe(100);
  });

  it("下端で移動できなかったとき、次回のスクロール目標だけが増え続けない", async () => {
    scroll.mockImplementation(() => {});
    const loader = new PageLoadMore();
    const options = {
      adapter: xAdapter,
      signal: new AbortController().signal,
      isCurrent: () => true,
      collect,
    };
    const first = loader.run(options);
    await vi.runAllTimersAsync();
    await first;
    const firstTarget = scroll.mock.calls[0]?.[0].top;
    scroll.mockClear();
    const second = loader.run(options);
    await vi.runAllTimersAsync();
    await second;
    expect(scroll.mock.calls[0]?.[0].top).toBe(firstTarget);
  });

  it("先頭のヘッダーだけが見えるプロフィールでも、読み込み後は先頭へ戻る", async () => {
    y = 0;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        top: 1000 - y,
        bottom: 1300 - y,
        height: 300,
        width: 500,
        left: 0,
        right: 500,
        x: 0,
        y: 1000 - y,
        toJSON() {},
      }),
    );
    scroll.mockImplementation((options) => {
      y = options.top ?? y;
      document.body.innerHTML = y > 0 ? post("1") + post("2") : post("1");
    });
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 1 });
    expect(y).toBe(0);
  });

  it("途中の位置で見えている投稿がない場合は、安全に復元できないため動かさない", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        top: 1000,
        bottom: 1300,
        height: 300,
        width: 500,
        left: 0,
        right: 500,
        x: 0,
        y: 1000,
        toJSON() {},
      }),
    );
    expect(await run()).toEqual({ status: "unsupported", added: 0 });
    expect(scroll).not.toHaveBeenCalled();
  });

  it("Blueskyの内側スクロール領域で読み込み、文書の位置には触れない", async () => {
    const bluePost = (id: string) =>
      `<div data-testid="feedItem-by-example.bsky.social"><a href="/profile/example.bsky.social/post/${id}">時刻</a><button data-testid="likeBtn" aria-label="100 likes"></button></div>`;
    document.body.innerHTML = `<div id="feed-scroll" style="overflow-y:auto">${bluePost("one")}</div>`;
    const scroller = document.querySelector<HTMLElement>("#feed-scroll");
    if (!scroller) throw Error("スクロール領域がありません");
    Object.defineProperty(scroller, "clientHeight", { value: 400 });
    scroller.scrollTop = 50;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const top = this === scroller ? 50 : 120 - scroller.scrollTop;
        const height = this === scroller ? 400 : 200;
        return {
          top,
          bottom: top + height,
          height,
          width: 500,
          left: 0,
          right: 500,
          x: 0,
          y: top,
          toJSON() {},
        };
      },
    );
    const innerScroll = vi.fn((options: ScrollToOptions) => {
      scroller.scrollTop = options.top ?? scroller.scrollTop;
      scroller.innerHTML =
        scroller.scrollTop > 50
          ? bluePost("one") + bluePost("two")
          : bluePost("one");
    });
    vi.spyOn(scroller, "scrollTo").mockImplementation(
      innerScroll as typeof scroller.scrollTo,
    );
    const collectBlue = () => {
      for (const card of blueskyAdapter.getPostCards(document)) {
        const id = blueskyAdapter.readPostId(card);
        if (id) collected.add(id);
      }
      return collected.size;
    };
    const result = new PageLoadMore().run({
      adapter: blueskyAdapter,
      signal: new AbortController().signal,
      isCurrent: () => true,
      collect: collectBlue,
    });
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 1 });
    expect(innerScroll).toHaveBeenCalledTimes(2);
    expect(scroller.scrollTop).toBe(50);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("Blueskyの認証切れと制限表示も検出する", () => {
    document.body.innerHTML =
      '<div data-testid="errorMessage">Session expired, sign in again</div>';
    expect(pageLoadBlockReason(document, "bluesky")).toBe("authentication");
    document.body.innerHTML = '<div role="alert">Rate Limit Exceeded</div>';
    expect(pageLoadBlockReason(document, "bluesky")).toBe("limited");
  });
});

describe("追加取得メッセージの検証", () => {
  it("一覧識別子のない要求や不正な応答を受け付けない", () => {
    expect(isLoadMoreRequest({ type: PANEL_LOAD_MORE })).toBe(false);
    expect(
      isLoadMoreRequest({
        type: PANEL_LOAD_MORE,
        pageKey: "x",
        timelineKey: null,
      }),
    ).toBe(true);
    expect(isLoadMoreResponse({ status: "loaded", added: 1001 })).toBe(false);
    expect(isLoadMoreResponse({ status: "other", added: 0 })).toBe(false);
    expect(isLoadMoreResponse({ status: "loaded", added: 5 })).toBe(true);
  });
});
