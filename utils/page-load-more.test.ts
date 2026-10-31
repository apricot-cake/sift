import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blueskyAdapter } from "./adapters/bluesky.ts";
import { xAdapter } from "./adapters/x.ts";
import {
  PageLoadMore,
  pageLoadBlockReason,
  postScrollElement,
} from "./page-load-more.ts";
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

describe("投稿のスクロール領域", () => {
  it("高さが内容に追従するauto祖先を飛ばし、外側のスクロール領域を使う", () => {
    document.body.innerHTML = `<div id="feed-scroll" style="overflow-y:auto"><div id="layout" style="overflow-y:auto">${post("1")}</div></div>`;
    const scroller = document.querySelector<HTMLElement>("#feed-scroll");
    const layout = document.querySelector<HTMLElement>("#layout");
    const card = xAdapter.getPostCards(document)[0];
    if (!scroller || !layout || !card) throw Error("投稿の祖先がありません");
    Object.defineProperties(scroller, {
      clientHeight: { value: 400 },
      scrollHeight: { value: 2000 },
    });
    Object.defineProperties(layout, {
      clientHeight: { value: 2000 },
      scrollHeight: { value: 2000 },
    });
    expect(postScrollElement(card)).toBe(scroller);
  });

  it("スクロールできる内側領域がなければ、文書のスクロールへ戻す", () => {
    document.body.innerHTML = `<div id="layout" style="overflow-y:auto">${post("1")}</div>`;
    const layout = document.querySelector<HTMLElement>("#layout");
    const card = xAdapter.getPostCards(document)[0];
    if (!layout || !card) throw Error("投稿の祖先がありません");
    Object.defineProperties(layout, {
      clientHeight: { value: 2000 },
      scrollHeight: { value: 2000 },
    });
    expect(postScrollElement(card)).toBeNull();
  });
});

describe("一覧の1回分の追加読み込み", () => {
  it("初回移動後にサイトが位置を戻しても、実到達位置から続きを収集する", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const top = this.matches('[data-testid="cellInnerDiv"]') ? 120 - y : 20;
        return {
          top,
          bottom: top + 8000,
          height: 8000,
          width: 500,
          left: 0,
          right: 500,
          x: 0,
          y: top,
          toJSON() {},
        };
      },
    );
    let first = true;
    scroll.mockImplementation((options) => {
      if (first) {
        first = false;
        y = Math.min(options.top ?? y, 5000);
        setTimeout(() => {
          y = 100;
        }, 50);
        return;
      }
      y = options.top ?? y;
      document.body.innerHTML =
        y > 5000
          ? Array.from({ length: 21 }, (_, index) =>
              post(String(index + 1)),
            ).join("")
          : post("1");
    });
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 20 });
    expect(scroll.mock.calls[1]?.[0].top).toBeGreaterThan(5000);
    expect(scroll.mock.calls[1]?.[0].top).toBeLessThan(
      scroll.mock.calls[0]?.[0].top ?? 0,
    );
    expect(y).toBeGreaterThan(100);
  });

  it("新規1件では止まらず、段階的に次の20件を収集して到達位置を維持する", async () => {
    let nextId = 2;
    const advance = () => {
      document.body.innerHTML = post("1") + post(String(nextId++));
    };
    scroll.mockImplementation((options) => {
      y = options.top ?? y;
      if (y > 100) advance();
      else document.body.innerHTML = post("1");
    });
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 20 });
    expect(collected.size).toBe(21);
    expect(nextId).toBe(22);
    expect(y).toBeGreaterThan(100);
  });

  it("収集上限まで残り5件なら、20件を待たず上限で止める", async () => {
    collected = new Set(
      Array.from({ length: 995 }, (_, index) => String(index + 1)),
    );
    let nextId = 996;
    const advance = () => {
      document.body.innerHTML = post("1") + post(String(nextId++));
    };
    scroll.mockImplementation((options) => {
      y = options.top ?? y;
      if (y > 100) advance();
      else document.body.innerHTML = post("1");
    });
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 5 });
    expect(collected.size).toBe(1000);
    expect(nextId).toBe(1001);
    expect(y).toBeGreaterThan(100);
  });

  it("終端ではスクロールを連打せず、遅れて描画された投稿を待つ", async () => {
    scroll.mockImplementation((options) => {
      y = Math.min(options.top ?? y, 200);
      document.body.innerHTML = y > 100 ? post("1") + post("2") : post("1");
    });
    const result = run();
    setTimeout(() => {
      document.body.innerHTML = Array.from({ length: 21 }, (_, index) =>
        post(String(index + 1)),
      ).join("");
    }, 1400);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 20 });
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(y).toBeGreaterThan(100);
  });

  it("少数だけ増えた後に進捗がなければ、時間内で止めて到達位置を維持する", async () => {
    scroll.mockImplementation((options) => {
      y = options.top ?? y;
      document.body.innerHTML = y > 100 ? post("1") + post("2") : post("1");
    });
    const started = Date.now();
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 1 });
    expect(Date.now() - started).toBeLessThan(6000);
    expect(y).toBeGreaterThan(100);
  });

  it("増え続けても時間上限で収集を止め、部分結果を保持する", async () => {
    let nextId = 2;
    let nextAt = Date.now();
    const advance = () => {
      if (Date.now() < nextAt) return;
      nextAt = Date.now() + 600;
      document.body.innerHTML = post("1") + post(String(nextId++));
    };
    scroll.mockImplementation((options) => {
      y = options.top ?? y;
      if (y > 100) advance();
      else document.body.innerHTML = post("1");
    });
    const started = Date.now();
    const result = run();
    await vi.runAllTimersAsync();
    const response = await result;
    expect(response.status).toBe("loaded");
    expect(response.added).toBeGreaterThan(1);
    expect(response.added).toBeLessThan(20);
    expect(Date.now() - started).toBeLessThanOrEqual(6000);
    expect(y).toBeGreaterThan(100);
  });

  it("20件が揃ったら待機せず終了し、追加の位置変更を行わない", async () => {
    scroll.mockImplementation((options) => {
      y = options.top ?? y;
      document.body.innerHTML =
        y > 100
          ? Array.from({ length: 21 }, (_, index) =>
              post(String(index + 1)),
            ).join("")
          : post("1");
    });
    const started = Date.now();
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 20 });
    expect(Date.now() - started).toBe(0);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(y).toBeGreaterThan(100);
  });

  it("仮想DOMから以前の投稿が消えても、収集済みの投稿を保持する", async () => {
    let nextId = 2;
    scroll.mockImplementation((options) => {
      y = typeof options === "object" ? (options.top ?? y) : y;
      document.body.innerHTML = post(String(nextId++));
    });
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "loaded", added: 20 });
    expect(collected.size).toBe(21);
    expect(collected.has("1")).toBe(true);
    expect(document.querySelectorAll("article")).toHaveLength(1);
    expect(document.querySelector('a[href="/example/status/1"]')).toBeNull();
    expect(y).toBeGreaterThan(100);
    expect(scroll.mock.calls.at(-1)?.[0].top).toBe(y);
  });

  it("新しい投稿がなければ6秒以内で止め、到達位置を維持する", async () => {
    const started = Date.now();
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "no-progress", added: 0 });
    expect(Date.now() - started).toBeLessThanOrEqual(6000);
    expect(scroll.mock.calls.at(-1)?.[0].top).toBe(y);
    expect(y).toBeGreaterThan(100);
  });

  it("同じ一覧で中止しても、到達位置から追加のスクロールを行わない", async () => {
    const controller = new AbortController();
    const result = run(controller.signal);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "cancelled", added: 0 });
    expect(y).toBeGreaterThan(100);
    expect(scroll).toHaveBeenCalledTimes(1);
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
    y = 500;
    const input = new Event("wheel");
    Object.defineProperty(input, "isTrusted", { value: true });
    window.dispatchEvent(input);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: "cancelled" });
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(y).toBe(500);
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

  it("途中で制限が出たら追加取得を止め、到達位置を維持する", async () => {
    const result = run();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="alert">You are rate limited</div>',
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "limited", added: 0 });
    expect(y).toBeGreaterThan(100);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("収集で例外が発生したら、その場で止めて失敗を返す", async () => {
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
    expect(y).toBeGreaterThan(100);
    expect(scroll).toHaveBeenCalledTimes(1);
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

  it("次の要求では前回の到達位置から先へ進み、同じ区間を読み直さない", async () => {
    let nextId = 2;
    scroll.mockImplementation((options) => {
      y = options.top ?? y;
      document.body.innerHTML = Array.from({ length: 20 }, () =>
        post(String(nextId++)),
      ).join("");
    });
    const loader = new PageLoadMore();
    const options = {
      adapter: xAdapter,
      signal: new AbortController().signal,
      isCurrent: () => true,
      collect,
    };
    const first = loader.run(options);
    await vi.runAllTimersAsync();
    expect(await first).toEqual({ status: "loaded", added: 20 });
    const reached = y;
    expect(scroll).toHaveBeenCalledTimes(1);
    const second = loader.run(options);
    await vi.runAllTimersAsync();
    expect(await second).toEqual({ status: "loaded", added: 20 });
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll.mock.calls[1]?.[0].top).toBeGreaterThan(reached);
    expect(y).toBeGreaterThan(reached);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("先頭のヘッダーだけが見えるプロフィールでも、追加取得して到達位置を維持する", async () => {
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
    expect(y).toBeGreaterThan(0);
  });

  it("現在の表示領域に投稿がなくても、収集対象の投稿があれば先へ進める", async () => {
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
    const result = run();
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ status: "no-progress", added: 0 });
    expect(scroll).toHaveBeenCalled();
    expect(y).toBeGreaterThan(100);
  });

  it("Blueskyが内側の位置を戻しても到達位置から再開し、文書の位置には触れない", async () => {
    const bluePost = (id: string) =>
      `<div data-testid="feedItem-by-example.bsky.social"><a href="/profile/example.bsky.social/post/${id}">時刻</a><button data-testid="likeBtn" aria-label="100 likes"></button></div>`;
    document.body.innerHTML = `<div id="feed-scroll" style="overflow-y:auto">${bluePost("one")}</div>`;
    const scroller = document.querySelector<HTMLElement>("#feed-scroll");
    if (!scroller) throw Error("スクロール領域がありません");
    Object.defineProperties(scroller, {
      clientHeight: { value: 400 },
      scrollHeight: { value: 1200 },
    });
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
    let first = true;
    const innerScroll = vi.fn((options: ScrollToOptions) => {
      scroller.scrollTop = options.top ?? scroller.scrollTop;
      scroller.innerHTML =
        scroller.scrollTop > 50
          ? bluePost("one") + bluePost("two")
          : bluePost("one");
      if (first) {
        first = false;
        setTimeout(() => {
          scroller.scrollTop = 50;
        }, 50);
      }
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
    expect(innerScroll.mock.calls.at(-1)?.[0].top).toBe(scroller.scrollTop);
    expect(scroller.scrollTop).toBeGreaterThan(50);
    expect(innerScroll.mock.calls[1]?.[0].top).toBeGreaterThan(
      innerScroll.mock.calls[0]?.[0].top ?? 0,
    );
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
