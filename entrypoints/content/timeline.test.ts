import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { blueskyAdapter } from "../../utils/adapters/bluesky.ts";
import { xAdapter } from "../../utils/adapters/x.ts";
import { startContentRuntime } from "../../utils/content-runtime.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
  isFilterContextResponse,
} from "../../utils/filter-context.ts";
import { PageLoadMore } from "../../utils/page-load-more.ts";
import { PANEL_LOAD_MORE } from "../../utils/panel-load-more.ts";
import { POST_COLLECTION_LIMIT } from "../../utils/panel-post.ts";
import { defaults, type SiteSettings } from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";

let runtime: ReturnType<typeof startContentRuntime> | undefined;
function post(id: string, likes: number | null = 100): string {
  return `<div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/example/status/${id}"><time datetime="2026-10-25T00:00:00Z">時刻</time></a><div data-testid="tweetText">投稿${id}</div>${likes === null ? "" : `<button data-testid="like" aria-label="${likes} likes"></button>`}</article></div>`;
}
async function settings(patch: Partial<SiteSettings> = {}) {
  await settingsItem.setValue({
    siteSettings: {
      ...defaults.siteSettings,
      x: {
        ...defaults.siteSettings.x,
        minReactionsEnabled: false,
        hideReposts: false,
        ...patch,
      },
    },
  });
}
async function context(reset = false): Promise<FilterContextResponse> {
  const [value] = await fakeBrowser.runtime.onMessage.trigger(
    { type: FILTER_CONTEXT_REQUEST, ...(reset ? { reset: true } : {}) },
    {},
    () => {},
  );
  expect(isFilterContextResponse(value)).toBe(true);
  return value as unknown as FilterContextResponse;
}
beforeEach(async () => {
  fakeBrowser.reset();
  history.replaceState({}, "", "/i/lists/42");
  document.body.innerHTML = post("1");
  await settings();
});
afterEach(() => {
  runtime?.dispose();
  runtime = undefined;
  vi.restoreAllMocks();
});

describe("追加読み込みの受け付け", () => {
  async function request(page: FilterContextResponse) {
    const [response] = await fakeBrowser.runtime.onMessage.trigger(
      {
        type: PANEL_LOAD_MORE,
        pageKey: page.pageKey,
        timelineKey: page.timelineKey,
      },
      {},
      () => {},
    );
    return response;
  }

  it("同時要求は1回にまとめ、完了直後の次の明示要求を受け付ける", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10000);
    const pending = Promise.withResolvers<{
      status: "loaded";
      added: number;
    }>();
    const load = vi
      .spyOn(PageLoadMore.prototype, "run")
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ status: "loaded", added: 2 });
    runtime = startContentRuntime(undefined, xAdapter);
    const page = await context();
    const first = request(page);
    const second = request(page);
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve({ status: "loaded", added: 1 });
    expect(await first).toEqual({ status: "loaded", added: 1 });
    expect(await second).toEqual({ status: "loaded", added: 1 });
    expect(await request(page)).toEqual({ status: "loaded", added: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("元の一覧から移動した後の古い追加要求ではスクロールしない", async () => {
    const load = vi.spyOn(PageLoadMore.prototype, "run");
    runtime = startContentRuntime(undefined, xAdapter);
    const page = await context();
    history.replaceState({}, "", "/i/lists/43");
    expect(await request(page)).toEqual({ status: "unsupported", added: 0 });
    expect(load).not.toHaveBeenCalled();
  });

  it("制限が出た一覧では、時間を待っても自動再取得しない", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
    const load = vi
      .spyOn(PageLoadMore.prototype, "run")
      .mockResolvedValue({ status: "limited", added: 0 });
    runtime = startContentRuntime(undefined, xAdapter);
    const page = await context();
    expect(await request(page)).toEqual({ status: "limited", added: 0 });
    clock.mockReturnValue(50000);
    expect(await request(page)).toEqual({ status: "limited", added: 0 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("Blueskyでも同じ明示要求で1回分の読み込みを実行する", async () => {
    const load = vi
      .spyOn(PageLoadMore.prototype, "run")
      .mockResolvedValue({ status: "loaded", added: 2 });
    history.replaceState({}, "", "/profile/example.bsky.social");
    document.body.innerHTML =
      '<div data-testid="feedItem-by-example.bsky.social"><a href="/profile/example.bsky.social/post/one">時刻</a><button data-testid="likeBtn" aria-label="100 likes"></button></div>';
    runtime = startContentRuntime(undefined, blueskyAdapter);
    const page = await context();
    expect(page.site).toBe("bluesky");
    expect(await request(page)).toEqual({ status: "loaded", added: 2 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0].adapter).toBe(blueskyAdapter);
  });
});

describe("元のページを変更しない投稿の収集", () => {
  it("条件に合わない投稿も元のDOMには残し、パネルの応答だけを絞り込む", async () => {
    document.body.innerHTML = post("1", 100) + post("2", 200);
    const original = document.documentElement.outerHTML;
    const scroll = vi.spyOn(window, "scrollBy");
    runtime = startContentRuntime(undefined, xAdapter);
    await settings({ minReactionsEnabled: true, minReactions: 150 });
    expect((await context()).posts.map((p) => p.id)).toEqual(["2"]);
    expect(document.documentElement.outerHTML).toBe(original);
    expect(scroll).not.toHaveBeenCalled();
    await settings({ minReactionsEnabled: false });
    expect((await context()).posts.map((p) => p.id)).toEqual(["1", "2"]);
    expect(document.documentElement.outerHTML).toBe(original);
  });
  it("仮想リストから消えた投稿を保持し、同一IDの再描画は重複せず更新する", async () => {
    runtime = startContentRuntime(undefined, xAdapter);
    await context();
    document.body.innerHTML = post("2", 200);
    expect((await context()).posts.map((p) => p.id)).toEqual(["1", "2"]);
    document.body.innerHTML = post("1", 300);
    expect((await context()).posts.map((p) => [p.id, p.metricCount])).toEqual([
      ["1", 300],
      ["2", 200],
    ]);
  });
  it("蓄積済みでDOMから消えた投稿にも変更後の条件を適用する", async () => {
    runtime = startContentRuntime(undefined, xAdapter);
    await context();
    document.body.innerHTML = post("2", 500);
    await context();
    await settings({ minReactionsEnabled: true, minReactions: 200 });
    expect(await context()).toMatchObject({
      collectedCount: 2,
      metricSampleCount: 2,
      metricCounts: [100, 500],
    });
    expect((await context()).posts.map((p) => p.id)).toEqual(["2"]);
  });
  it("明示的に開き直した場合は現在のDOMから蓄積し直す", async () => {
    runtime = startContentRuntime(undefined, xAdapter);
    await context();
    document.body.innerHTML = post("2");
    expect((await context(true)).posts.map((p) => p.id)).toEqual(["2"]);
  });
  it("遅れた旧起動の初期化で、新しい起動後に収集した投稿を消さない", async () => {
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<typeof settingsItem.getValue>>
      >();
    const get = settingsItem.getValue.bind(settingsItem);
    vi.spyOn(settingsItem, "getValue").mockReturnValueOnce(pending.promise);
    runtime = startContentRuntime(undefined, xAdapter);
    const oldOpening = context(true);
    await context(true);
    document.body.innerHTML = post("2");
    expect((await context()).posts.map((p) => p.id)).toEqual(["1", "2"]);
    pending.resolve(await get());
    await oldOpening;
    expect((await context()).posts.map((p) => p.id)).toEqual(["1", "2"]);
  });
  it("破棄済みの読み取りが遅れて完了しても収集を再開しない", async () => {
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<typeof settingsItem.getValue>>
      >();
    vi.spyOn(settingsItem, "getValue").mockReturnValueOnce(pending.promise);
    runtime = startContentRuntime(undefined, xAdapter);
    const response = fakeBrowser.runtime.onMessage.trigger(
      { type: FILTER_CONTEXT_REQUEST },
      {},
      () => {},
    );
    runtime.dispose();
    pending.resolve(defaults);
    expect(await response).toEqual([undefined]);
  });
  it("別の一覧URLへ移ったら以前の投稿を混ぜない", async () => {
    runtime = startContentRuntime(undefined, xAdapter);
    await context();
    history.replaceState({}, "", "/i/lists/43");
    document.body.innerHTML = post("2");
    expect((await context()).posts.map((p) => p.id)).toEqual(["2"]);
  });
  it("同じURLでも選択した一覧タブが変われば蓄積を初期化する", async () => {
    history.replaceState({}, "", "/home");
    const tabs =
      '<div data-testid="ScrollSnap-List" role="tablist"><div role="tab" aria-selected="false">おすすめ</div><div role="tab" aria-selected="true">フォロー中</div><div role="tab" aria-selected="false">リスト</div></div>';
    document.body.innerHTML = tabs + post("1");
    runtime = startContentRuntime(undefined, xAdapter);
    await context();
    // 同じURLでタブバーの描き直しを挟んでも、直前に確定した一覧を忘れない。
    document.body.innerHTML = post("1");
    expect((await context()).timelineAvailable).toBe(false);
    document.body.innerHTML = tabs + post("1");
    const allTabs = document.querySelectorAll('[role="tab"]');
    allTabs[1]?.setAttribute("aria-selected", "false");
    allTabs[2]?.setAttribute("aria-selected", "true");
    document.querySelector('[data-testid="cellInnerDiv"]')?.remove();
    document.body.insertAdjacentHTML("beforeend", post("2"));
    expect((await context()).posts.map((p) => p.id)).toEqual(["2"]);
  });
  it("画像モーダル内では背景の一覧キーと蓄積を保つ", async () => {
    document.body.innerHTML = `<div data-testid="primaryColumn">${post("1")}</div>`;
    runtime = startContentRuntime(undefined, xAdapter);
    const first = await context();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="dialog">${post("99")}</div>`,
    );
    history.pushState(
      { state: { fromApp: true, previousPath: "/i/lists/42" } },
      "",
      "/example/status/1/photo/1",
    );
    const modal = await context();
    expect(modal.pageKey).toBe(first.pageKey);
    expect(modal.timelineKey).toBeNull();
    expect(modal.posts.map((p) => p.id)).toEqual(["1"]);
  });
  it("対象外のおすすめでは投稿情報を収集しない", async () => {
    history.replaceState({}, "", "/home");
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div data-testid="ScrollSnap-List" role="tablist"><div role="tab" aria-selected="true">おすすめ</div><div role="tab" aria-selected="false">フォロー中</div></div>',
    );
    const read = vi.fn(xAdapter.readPost.bind(xAdapter));
    runtime = startContentRuntime(undefined, { ...xAdapter, readPost: read });
    expect(await context()).toMatchObject({
      timelineAvailable: false,
      posts: [],
      collectedCount: 0,
    });
    expect(read).not.toHaveBeenCalled();
  });
  it("1,000件の上限を明示し、新規IDは追加せず既存の更新を反映する", async () => {
    document.body.innerHTML = Array.from(
      { length: POST_COLLECTION_LIMIT },
      (_, i) => post(String(i + 1)),
    ).join("");
    runtime = startContentRuntime(undefined, xAdapter);
    expect(await context()).toMatchObject({
      collectedCount: POST_COLLECTION_LIMIT,
      collectionTruncated: false,
    });
    document.body.innerHTML = post("1", 500) + post("2000", 1000);
    const limited = await context();
    expect(limited.collectedCount).toBe(POST_COLLECTION_LIMIT);
    expect(limited.collectionTruncated).toBe(true);
    expect(limited.posts[0]?.metricCount).toBe(500);
    expect(limited.posts.some((p) => p.id === "2000")).toBe(false);
    expect(await context(true)).toMatchObject({
      collectedCount: 2,
      collectionTruncated: false,
    });
  });
  it("最低値、媒体、返信・引用・リポストの条件を蓄積情報へ適用する", async () => {
    document.body.innerHTML = [
      post("1", 100),
      post("2", 200),
      post("3", 300),
      post("4", 400),
      post("5", 500),
    ].join("");
    const adapter = {
      ...xAdapter,
      readPost(card: Element) {
        const p = xAdapter.readPost(card);
        return (
          p && {
            ...p,
            hasImage: p.id !== "2",
            hasVideo: p.id === "2",
            isReply: p.id === "3",
            isQuote: p.id === "4",
            isRepost: p.id === "5",
          }
        );
      },
    };
    runtime = startContentRuntime(undefined, adapter);
    await settings({
      mediaEnabled: true,
      mediaMode: "images",
      hideReplies: true,
      hideQuotes: true,
      hideReposts: true,
    });
    expect((await context()).posts.map((p) => p.id)).toEqual(["1"]);
    await settings({
      mediaEnabled: true,
      mediaMode: "video",
      hideReplies: true,
      hideQuotes: true,
      hideReposts: true,
    });
    expect((await context()).posts.map((p) => p.id)).toEqual(["2"]);
    await settings({
      minReactionsEnabled: true,
      minReactions: 350,
      hideReposts: true,
    });
    expect((await context()).posts.map((p) => p.id)).toEqual(["4"]);
  });
  it("いいね数が不明な投稿は最低値ありでは掲載せず、指定なしでは掲載する", async () => {
    document.body.innerHTML = post("1", null);
    await settings({ minReactionsEnabled: true, minReactions: 100000 });
    runtime = startContentRuntime(undefined, xAdapter);
    expect(await context()).toMatchObject({
      posts: [],
      metricSampleCount: 1,
      metricCounts: [],
    });
    await settings({ minReactionsEnabled: false });
    expect((await context()).posts).toMatchObject([
      { id: "1", metricCount: null },
    ]);
  });
  it("投稿URLを読めない状態が続くと、正常な空一覧として扱わない", async () => {
    document.querySelector("a")?.remove();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    runtime = startContentRuntime(undefined, xAdapter);
    expect((await context()).health?.state).toBe("loading");
    clock.mockReturnValue(10000);
    expect((await context()).health).toMatchObject({
      state: "unreadable",
      issue: "posts",
    });
    document.body.innerHTML = post("1");
    expect((await context()).health?.state).toBe("ready");
  });
  it("一部の投稿リンクが壊れていても、指標の取得失敗とは区別して知らせる", async () => {
    document.body.innerHTML = post("1") + post("2");
    document.querySelectorAll("a")[1]?.remove();
    runtime = startContentRuntime(undefined, xAdapter);
    const result = await context();
    expect(result.health).toMatchObject({
      state: "degraded",
      issue: "posts",
      sampledPosts: 2,
      readableMetrics: 2,
    });
    expect(result.collectedCount).toBe(1);
  });
  it("本文を表示できる場合は、最低値なしで指標の欠損だけを理由に操作を止めない", async () => {
    document.body.innerHTML = post("1", null);
    runtime = startContentRuntime(undefined, xAdapter);
    expect((await context()).health?.state).toBe("degraded");
  });
  it("別のメッセージへ応答せず、閉じたパネル向けの常駐タイマーも作らない", async () => {
    const interval = vi.spyOn(window, "setInterval");
    runtime = startContentRuntime(undefined, xAdapter);
    const response = await fakeBrowser.runtime.onMessage.trigger(
      { type: "other" },
      {},
      () => {},
    );
    expect(response).toEqual([undefined]);
    expect(interval).not.toHaveBeenCalled();
  });
  it("bfcacheで保存したページは復帰後も読め、破棄時はメッセージ受信を解除する", async () => {
    runtime = startContentRuntime(undefined, xAdapter);
    const event = new Event("pagehide");
    Object.defineProperty(event, "persisted", { value: true });
    window.dispatchEvent(event);
    expect((await context()).posts).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    const response = await fakeBrowser.runtime.onMessage.trigger(
      { type: FILTER_CONTEXT_REQUEST },
      {},
      () => {},
    );
    expect(response).toEqual([]);
  });
  it("Blueskyの実DOM契約からも新しい投稿応答を作る", async () => {
    history.replaceState({}, "", "/profile/example.test/lists/abc");
    document.body.innerHTML =
      '<div data-testid="feedItem-by-example.test"><a href="/profile/example.test/post/abc">投稿時刻</a><button data-testid="likeBtn" aria-label="1000 likes"></button><div data-testid="postText">本文</div></div>';
    runtime = startContentRuntime(undefined, blueskyAdapter);
    expect((await context()).posts[0]).toMatchObject({
      url: "https://bsky.app/profile/example.test/post/abc",
    });
  });
});
