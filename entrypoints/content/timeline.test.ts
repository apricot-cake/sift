import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import { blueskyAdapter } from "../../utils/adapters/bluesky.ts";
import { niconicoAdapter } from "../../utils/adapters/niconico.ts";
import { xAdapter } from "../../utils/adapters/x.ts";
import { youtubeAdapter } from "../../utils/adapters/youtube.ts";
import { startContentRuntime } from "../../utils/content-runtime.ts";
import {
  FILTER_CONTEXT_METRIC_LIMIT,
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../../utils/filter-context.ts";
import { TIMELINE_CONTROL } from "../../utils/timeline-controls.ts";

const timelineMarkup = `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="tweetPhoto"></div>
      <button data-testid="like" aria-label="1,100 件のいいね"></button>
      <time datetime="2026-08-01T12:00:00.000Z"></time>
    </article>
  </div>
`;

function xPostMarkup(
  id: string,
  likes = 0,
  hasThreadConnector = false,
): string {
  return `
    <div data-testid="cellInnerDiv">
      <article data-testid="tweet">
        ${hasThreadConnector ? '<div><div data-testid="Tweet-User-Avatar"></div><div data-thread-connector></div></div>' : ""}
        <a href="/example/status/${id}">
          <time datetime="2026-08-01T12:00:00.000Z"></time>
        </a>
        <button data-testid="like" aria-label="${likes} likes"></button>
      </article>
    </div>
  `;
}

beforeEach(() => {
  fakeBrowser.reset();
  history.replaceState({}, "", "/example");
  document.body.innerHTML = "";
});

async function setFiltering(enabled: boolean): Promise<void> {
  await fakeBrowser.runtime.onMessage.trigger(
    { type: TIMELINE_CONTROL.setFiltering, enabled },
    {},
    () => {},
  );
}

async function getFilterContext(): Promise<FilterContextResponse> {
  const [response] = await fakeBrowser.runtime.onMessage.trigger(
    { type: FILTER_CONTEXT_REQUEST },
    {},
    () => {},
  );
  return response as unknown as FilterContextResponse;
}

function dispatchPageTransition(
  type: "pagehide" | "pageshow",
  persisted: boolean,
): void {
  const event = new Event(type) as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

function dispatchTrustedWheel(deltaY: number): void {
  const event = new WheelEvent("wheel", { deltaY });
  Object.defineProperty(event, "isTrusted", { value: true });
  window.dispatchEvent(event);
}

describe("タイムラインのフィルター", () => {
  it("並び順を読めない対応ページは取得失敗になり、復旧後は正常に戻る", async () => {
    history.replaceState({}, "", "/@example/videos");
    document.body.innerHTML =
      '<ytd-browse><button role="combobox">不明な表示</button><ytd-video-renderer><div id="metadata-line"><span>1万回視聴</span></div></ytd-video-renderer></ytd-browse>';
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      youtubeAdapter,
    );
    try {
      expect((await getFilterContext()).health).toMatchObject({
        state: "loading",
        issue: "page",
      });
      clock.mockReturnValue(10000);
      expect((await getFilterContext()).health).toMatchObject({
        state: "unreadable",
        issue: "page",
      });
      const sortButton = document.querySelector("button");
      if (!sortButton) throw new Error("並び順がありません");
      sortButton.textContent = "新しい順";
      await vi.waitFor(async () =>
        expect((await getFilterContext()).health?.state).toBe("ready"),
      );
      sortButton.textContent = "古い順";
      expect((await getFilterContext()).health?.state).toBe("unsupported");
    } finally {
      runtime.dispose();
      clock.mockRestore();
    }
  });
  it("指標の取得失敗を0件と混同せず、実投稿の更新で復旧する", async () => {
    document.body.innerHTML =
      '<article data-testid="tweet"><button data-testid="renamed-like"></button></article>';
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    try {
      expect((await getFilterContext()).health?.state).toBe("loading");
      clock.mockReturnValue(10000);
      expect((await getFilterContext()).health).toMatchObject({
        state: "unreadable",
        issue: "metrics",
        sampledPosts: 1,
      });
      const button = document.querySelector("button");
      if (!button) throw new Error("指標ボタンがありません");
      button.setAttribute("data-testid", "like");
      button.setAttribute("aria-label", "100 likes");
      await vi.waitFor(async () =>
        expect((await getFilterContext()).health?.state).toBe("ready"),
      );
    } finally {
      runtime.dispose();
      clock.mockRestore();
    }
  });
  it("静止中の再判定と問い合わせで投稿を読み直さず、指標の変更には追従する", async () => {
    document.body.innerHTML = timelineMarkup;
    const readMetricCount = vi.fn(xAdapter.readMetricCount);
    const runtime = startContentRuntime(new ContentScriptContext("sift-test"), {
      ...xAdapter,
      readMetricCount,
    });
    try {
      await setFiltering(true);
      await vi.waitFor(() =>
        expect(
          document.querySelector("[data-sift-filter-state]"),
        ).not.toBeNull(),
      );
      expect((await getFilterContext()).metricCounts).toEqual([1100]);
      readMetricCount.mockClear();
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      await getFilterContext();
      await getFilterContext();
      expect(readMetricCount).not.toHaveBeenCalled();

      document
        .querySelector("button")
        ?.setAttribute("aria-label", "900 件のいいね");
      await vi.waitFor(() => expect(readMetricCount).toHaveBeenCalled());
      expect((await getFilterContext()).metricCounts).toEqual([900]);

      document.body.insertAdjacentHTML("beforeend", xPostMarkup("new", 2000));
      await vi.waitFor(async () =>
        expect((await getFilterContext()).metricCounts).toEqual([900, 2000]),
      );
    } finally {
      runtime.dispose();
    }
  });
  it("パネル用の投稿走査と応答件数を上限内に収める", async () => {
    const cards = Array.from(
      { length: FILTER_CONTEXT_METRIC_LIMIT + 1 },
      (_, index) => xPostMarkup(String(index), index),
    ).join("");
    document.body.innerHTML = cards;
    const readMetricCount = vi.fn(xAdapter.readMetricCount);
    const runtime = startContentRuntime(new ContentScriptContext("sift-test"), {
      ...xAdapter,
      readMetricCount,
    });
    try {
      const context = await getFilterContext();
      expect(context.metricCounts).toHaveLength(FILTER_CONTEXT_METRIC_LIMIT);
      expect(readMetricCount).toHaveBeenCalledTimes(
        FILTER_CONTEXT_METRIC_LIMIT + 64,
      );
    } finally {
      runtime.dispose();
    }
  });
  it("再評価で結果が変わらない投稿の属性を書き換えない", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    const writes: MutationRecord[] = [];
    const mutations = new MutationObserver((records) =>
      writes.push(...records),
    );
    try {
      await setFiltering(true);
      await vi.waitFor(() =>
        expect(
          document.querySelector("[data-sift-filter-state]"),
        ).not.toBeNull(),
      );
      mutations.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-sift-filter-state", "data-sift-filter-reason"],
      });
      document.querySelector("article")?.append(document.createElement("span"));
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      expect(writes).toHaveLength(0);
    } finally {
      mutations.disconnect();
      runtime.dispose();
    }
  });
  it.each(["/i/lists/add_member", "/example/status/100/photo/1"])(
    "%s への遷移でパネルが停止しても、戻った一覧の位置を復元する",
    async (path) => {
      history.replaceState({}, "", "/home");
      document.body.innerHTML = `<div data-testid="ScrollSnap-List" role="tablist">
        <div role="tab" aria-selected="false">おすすめ</div>
        <div role="tab" aria-selected="false">フォロー中</div>
        <div role="tab" aria-selected="true">リスト</div>
      </div>${xPostMarkup("100", 1_100)}`;
      let top = -30;
      const cell = document.querySelector(
        '[data-testid="cellInnerDiv"]',
      ) as HTMLElement;
      const rect = vi
        .spyOn(cell, "getBoundingClientRect")
        .mockImplementation(() => new DOMRect(0, top, 500, 300));
      const scroll = vi
        .spyOn(window, "scrollBy")
        .mockImplementation((...args: unknown[]) => {
          top -= (args[0] as ScrollToOptions).top ?? 0;
        });
      const runtime = startContentRuntime(
        new ContentScriptContext("sift-test"),
        xAdapter,
      );
      try {
        await setFiltering(true);
        await vi.waitFor(() =>
          expect(cell.dataset.siftFilterState).toBe("matched"),
        );
        history.pushState({}, "", path);
        await setFiltering(false);
        top = 470;
        history.pushState({}, "", "/home");
        await setFiltering(true);
        await vi.waitFor(() => expect(top).toBe(-30));
      } finally {
        runtime.dispose();
        rect.mockRestore();
        scroll.mockRestore();
      }
    },
  );

  it("拡張機能が無効になった後は監視を停止し、DOMを再変更しない", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      fakeBrowser.runtime,
      "id",
    );
    try {
      await setFiltering(true);
      await vi.waitFor(() =>
        expect(
          document.querySelector("[data-sift-filter-state]"),
        ).not.toBeNull(),
      );
      Object.defineProperty(fakeBrowser.runtime, "id", {
        configurable: true,
        value: undefined,
      });
      await vi.waitFor(() =>
        expect(document.querySelector("[data-sift-filter-state]")).toBeNull(),
      );
      const cell = document.querySelector<HTMLElement>(
        '[data-testid="cellInnerDiv"]',
      );
      if (!cell) throw new Error("投稿がない");
      cell.dataset.siftFilterState = "hidden";
      cell.append(document.createElement("span"));
      await new Promise((resolve) => window.setTimeout(resolve, 850));
      expect(cell.dataset.siftFilterState).toBe("hidden");
    } finally {
      if (descriptor)
        Object.defineProperty(fakeBrowser.runtime, "id", descriptor);
      runtime.dispose();
    }
  });
  it("絞り込み中はセルフリプの接続線を隠す", async () => {
    document.body.innerHTML = xPostMarkup("100", 1_100, true);
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    const connector = document.querySelector<HTMLElement>(
      "[data-thread-connector]",
    );
    try {
      await setFiltering(true);
      await vi.waitFor(() => {
        expect(
          connector?.hasAttribute("data-sift-thread-connector-hidden"),
        ).toBe(true);
      });

      await setFiltering(false);
      await vi.waitFor(() => {
        expect(
          connector?.hasAttribute("data-sift-thread-connector-hidden"),
        ).toBe(false);
      });
    } finally {
      runtime.dispose();
    }
  });

  it("ピン留めリストから開いた投稿は表示し、戻ると再び絞り込む", async () => {
    history.replaceState({}, "", "/home");
    document.body.innerHTML = `
      <div data-testid="ScrollSnap-List" role="tablist">
        <div role="tab" aria-selected="false">おすすめ</div>
        <div role="tab" aria-selected="false">フォロー中</div>
        <div role="tab" aria-selected="true">リスト</div>
      </div>
      ${xPostMarkup("100")}${xPostMarkup("200")}
    `;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    const cells = document.querySelectorAll<HTMLElement>(
      '[data-testid="cellInnerDiv"]',
    );
    try {
      await setFiltering(true);
      await vi.waitFor(() => {
        expect(cells[0]?.dataset.siftFilterState).toBe("hidden");
        expect(cells[1]?.dataset.siftFilterState).toBe("hidden");
      });

      history.pushState({}, "", "/example/status/100");
      await vi.waitFor(
        () => {
          expect(cells[0]?.dataset.siftFilterState).toBeUndefined();
          expect(cells[1]?.dataset.siftFilterState).toBeUndefined();
        },
        { timeout: 2_000 },
      );

      history.pushState({}, "", "/quoted/status/200");
      await vi.waitFor(
        () => {
          expect(cells[0]?.dataset.siftFilterState).toBeUndefined();
          expect(cells[1]?.dataset.siftFilterState).toBeUndefined();
        },
        { timeout: 2_000 },
      );

      history.pushState({}, "", "/home");
      await vi.waitFor(
        () => {
          expect(cells[0]?.dataset.siftFilterState).toBe("hidden");
          expect(cells[1]?.dataset.siftFilterState).toBe("hidden");
        },
        { timeout: 2_000 },
      );
      expect((await getFilterContext()).filteringEnabled).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it("投稿を絞り込み、ページ上の操作UIは作らない", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    expect(document.querySelector("[data-sift-filter-state]")).toBeNull();
    await setFiltering(true);

    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLElement>("[data-sift-filter-state]"),
      ).not.toBeNull();
    });
    expect(document.body.children).toHaveLength(1);

    runtime.dispose();
  });

  it("不一致投稿が続いてもフィルターを解除しない", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await setFiltering(true);
    document.body.insertAdjacentHTML(
      "beforeend",
      timelineMarkup.replace("1,100", "0").repeat(30),
    );

    await vi.waitFor(() => {
      expect(
        document.querySelectorAll('[data-sift-filter-state="hidden"]'),
      ).toHaveLength(30);
    });
    expect((await getFilterContext()).filteringEnabled).toBe(true);

    runtime.dispose();
  });

  it("ユーザー操作なしの全件不一致取得が3回続いたら警告だけを出す", async () => {
    document.body.innerHTML = xPostMarkup("baseline", 1_100);
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await setFiltering(true);
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-sift-filter-state="matched"]'),
      ).not.toBeNull();
    });

    for (const id of ["1", "2", "3"]) {
      document.body.insertAdjacentHTML("beforeend", xPostMarkup(id));
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }

    const context = await getFilterContext();
    expect(context.continuousLoadingWarning).toBe(true);
    expect(context.filteringEnabled).toBe(true);
    expect(
      document.querySelectorAll('[data-sift-filter-state="hidden"]'),
    ).toHaveLength(3);

    runtime.dispose();
  });

  it("投稿のない画面には操作UIもフィルター状態も残さない", async () => {
    document.body.innerHTML = '<div data-testid="primaryColumn">settings</div>';
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await setFiltering(true);

    await vi.waitFor(() => {
      expect(document.querySelector("article")).toBeNull();
    });
    expect(document.body.children).toHaveLength(1);
    expect(document.querySelector("[data-sift-filter-state]")).toBeNull();
    expect(document.querySelector("[data-sift-empty-state]")).toBeNull();

    runtime.dispose();
  });

  it("Blueskyの空の専用リストでもページへUIを足さない", async () => {
    history.replaceState({}, "", "/profile/alice.test/lists/abc");
    document.body.innerHTML = '<div data-testid="homeScreen"></div>';
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      blueskyAdapter,
    );
    await setFiltering(true);

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(
      document.querySelector('[data-testid="homeScreen"]')?.children,
    ).toHaveLength(0);

    runtime.dispose();
  });

  it("Blueskyで初期投稿が全件不一致でも次ページ判定を進める", async () => {
    history.replaceState({}, "", "/profile/alice.test");
    document.body.innerHTML = `
      <div data-testid="homeScreenFeedTabs-selector-Following">
        <div style="background-color: blue"></div>
      </div>
      <div data-testid="feedItem-by-alice.test">
        <a href="/profile/alice.test/post/abc"></a>
        <button data-testid="likeBtn" aria-label="0 likes"></button>
      </div>
    `;
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    scrollTo.mockClear();
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      blueskyAdapter,
    );
    await setFiltering(true);

    await vi.waitFor(() => {
      expect(
        document.documentElement.hasAttribute("data-sift-layout-probe"),
      ).toBe(true);
      expect(scrollTo).toHaveBeenCalled();
    });
    expect(
      document.querySelector('[data-sift-filter-state="hidden"]'),
    ).not.toBeNull();

    runtime.dispose();
    expect(
      document.documentElement.hasAttribute("data-sift-layout-probe"),
    ).toBe(false);
  });

  it("Blueskyで一致が一件だけで表示範囲を満たさなくても次ページ判定を進める", async () => {
    history.replaceState({}, "", "/profile/alice.test");
    document.body.innerHTML = `
      <div data-testid="homeScreenFeedTabs-selector-Following">
        <div style="background-color: blue"></div>
      </div>
      <div data-testid="feedItem-by-alice.test">
        <a href="/profile/alice.test/post/matched"></a>
        <button data-testid="likeBtn" aria-label="1,100 likes"></button>
      </div>
      <div data-testid="feedItem-by-bob.test">
        <a href="/profile/bob.test/post/hidden"></a>
        <button data-testid="likeBtn" aria-label="0 likes"></button>
      </div>
    `;
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      blueskyAdapter,
    );
    await setFiltering(true);

    await vi.waitFor(() => {
      expect(
        document.documentElement.hasAttribute("data-sift-layout-probe"),
      ).toBe(true);
      expect(scrollTo).toHaveBeenCalled();
    });
    expect(
      document.querySelectorAll('[data-sift-filter-state="matched"]'),
    ).toHaveLength(1);

    runtime.dispose();
  });

  it("連続するBlueskyの次ページ判定を3回で止める", async () => {
    history.replaceState({}, "", "/profile/alice.test");
    document.body.innerHTML = `
      <div data-testid="homeScreenFeedTabs-selector-Following">
        <div style="background-color: blue"></div>
      </div>
      <div data-testid="feedItem-by-baseline.test">
        <a href="/profile/baseline.test/post/baseline"></a>
        <button data-testid="likeBtn" aria-label="0 likes"></button>
      </div>
    `;
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      blueskyAdapter,
    );
    try {
      await setFiltering(true);

      for (const id of ["1", "2", "3"]) {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div data-testid="feedItem-by-${id}.test">
            <a href="/profile/${id}.test/post/${id}"></a>
            <button data-testid="likeBtn" aria-label="0 likes"></button>
          </div>`,
        );
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }

      await vi.waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(6), {
        timeout: 8_000,
      });
      scrollTo.mockClear();
      await new Promise((resolve) => window.setTimeout(resolve, 2_500));

      expect(scrollTo).not.toHaveBeenCalled();
      expect(
        document.documentElement.hasAttribute("data-sift-layout-probe"),
      ).toBe(false);
    } finally {
      runtime.dispose();
    }
  }, 12_000);

  it.each(["wheel", "keyboard", "touch", "pointer", "matched"])(
    "Blueskyの上限到達後に%sで再開し、再び3回で止まる",
    async (action) => {
      vi.useFakeTimers();
      history.replaceState({}, "", "/profile/alice.test");
      document.body.innerHTML = `
        <div data-testid="feedItem-by-alice.test">
          <a href="/profile/alice.test/post/abc"></a>
          <button data-testid="likeBtn" aria-label="0 likes"></button>
        </div>
      `;
      const scrollTo = vi
        .spyOn(window, "scrollTo")
        .mockImplementation(() => {});
      scrollTo.mockClear();
      const runtime = startContentRuntime(undefined, blueskyAdapter);
      try {
        await setFiltering(true);
        await vi.advanceTimersByTimeAsync(9_000);
        expect(scrollTo).toHaveBeenCalledTimes(6);
        scrollTo.mockClear();

        // 自動スクロールの通知やサイトが発火した入力では上限を解除しない。
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
        await vi.advanceTimersByTimeAsync(3_000);
        expect(scrollTo).not.toHaveBeenCalled();

        if (action === "matched") {
          const card = document.querySelector<HTMLElement>(
            "[data-testid^='feedItem']",
          );
          const metric = card?.querySelector("button");
          if (!card || !metric) throw new Error("投稿カードがありません。");
          vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
            bottom: window.innerHeight + 100,
          } as DOMRect);
          metric.setAttribute("aria-label", "1,100 likes");
          await vi.advanceTimersByTimeAsync(100);
          expect(scrollTo).not.toHaveBeenCalled();
          metric.setAttribute("aria-label", "0 likes");
        } else {
          const event =
            action === "wheel"
              ? new WheelEvent("wheel", { deltaY: 100 })
              : action === "keyboard"
                ? new KeyboardEvent("keydown", { key: "PageDown" })
                : new Event(action === "touch" ? "touchstart" : "pointerdown");
          Object.defineProperty(event, "isTrusted", { value: true });
          window.dispatchEvent(event);
        }
        await vi.advanceTimersByTimeAsync(100);
        expect(scrollTo).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(9_000);
        expect(scrollTo).toHaveBeenCalledTimes(6);
        expect(
          document.documentElement.hasAttribute("data-sift-layout-probe"),
        ).toBe(false);
      } finally {
        runtime.dispose();
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    },
  );

  it("Blueskyがフィードの終端を示した後は読み込み判定を再開しない", async () => {
    history.replaceState({}, "", "/profile/alice.test");
    document.body.innerHTML = `
      <div data-testid="homeScreenFeedTabs-selector-Following">
        <div style="background-color: blue"></div>
      </div>
      <div data-testid="postsFeed-flatlist">
        <div data-testid="feedItem-by-alice.test">
          <a href="/profile/alice.test/post/abc"></a>
          <button data-testid="likeBtn" aria-label="0 likes"></button>
        </div>
        <div><div dir="auto">フィードの終わり</div></div>
      </div>
    `;
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    scrollTo.mockClear();
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      blueskyAdapter,
    );
    await setFiltering(true);

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-sift-filter-state="hidden"]'),
      ).not.toBeNull();
    });
    expect(
      document.documentElement.hasAttribute("data-sift-layout-probe"),
    ).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();

    dispatchTrustedWheel(100);
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(
      document.documentElement.hasAttribute("data-sift-layout-probe"),
    ).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();

    runtime.dispose();
  });

  it("Blueskyで読み込み判定中に上へスクロールしたら最下部への移動を止める", async () => {
    history.replaceState({}, "", "/profile/alice.test");
    document.body.innerHTML = `
      <div data-testid="homeScreenFeedTabs-selector-Following">
        <div style="background-color: blue"></div>
      </div>
      <div data-testid="feedItem-by-alice.test">
        <a href="/profile/alice.test/post/abc"></a>
        <button data-testid="likeBtn" aria-label="0 likes"></button>
      </div>
    `;
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const scrollingElement =
      document.scrollingElement ?? document.documentElement;
    scrollingElement.scrollTop = 600;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      blueskyAdapter,
    );
    await setFiltering(true);

    await vi.waitFor(() => {
      expect(
        document.documentElement.hasAttribute("data-sift-layout-probe"),
      ).toBe(true);
    });

    dispatchTrustedWheel(-100);
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(
      document.documentElement.hasAttribute("data-sift-layout-probe"),
    ).toBe(false);
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 500,
      behavior: "instant",
    });

    dispatchTrustedWheel(100);
    await vi.waitFor(() => {
      expect(
        document.documentElement.hasAttribute("data-sift-layout-probe"),
      ).toBe(true);
    });

    runtime.dispose();
  });

  it.each(["対象外ページ", "古い順"])(
    "YouTubeの%sへ移るとフィルター状態を消す",
    async (destination) => {
      history.replaceState({}, "", "/@sift/videos");
      document.body.innerHTML = `
      <ytd-browse><button role="tab" aria-selected="true">新しい順</button></ytd-browse>
      <ytd-video-renderer>
        <div id="metadata-line">
          <span>1万回視聴</span>
          <span>1日前</span>
        </div>
      </ytd-video-renderer>
    `;
      const runtime = startContentRuntime(
        new ContentScriptContext("sift-test"),
        youtubeAdapter,
      );
      await setFiltering(true);

      await vi.waitFor(() => {
        expect(
          document.querySelector("[data-sift-filter-state]"),
        ).not.toBeNull();
      });

      if (destination === "古い順") {
        const chip = document.querySelector('[role="tab"]');
        if (chip) chip.textContent = "古い順";
      } else {
        history.pushState({}, "", "/");
      }
      document.body.append(document.createElement("div"));

      await vi.waitFor(() => {
        expect(document.querySelector("[data-sift-filter-state]")).toBeNull();
      });

      runtime.dispose();
    },
  );

  it("戻る操作でキャッシュから復元された後もサイドパネルへ応答する", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await setFiltering(true);

    dispatchPageTransition("pagehide", true);
    dispatchPageTransition("pageshow", true);

    await expect(getFilterContext()).resolves.toMatchObject({
      site: "x",
      filteringEnabled: true,
    });

    runtime.dispose();
  });

  it.each([
    {
      adapter: xAdapter,
      path: "/search?q=sift&f=live",
      markup: xPostMarkup("100", 14000) + xPostMarkup("200", 800),
    },
    {
      adapter: blueskyAdapter,
      path: "/profile/example.bsky.social",
      markup: [14000, 800]
        .map(
          (count) =>
            `<div data-testid="feedItem-by-example.bsky.social"><button data-testid="likeBtn" aria-label="${count} likes"></button></div>`,
        )
        .join(""),
    },
    {
      adapter: niconicoAdapter,
      path: "/user/123/video?sortKey=viewCount&sortOrder=desc",
      markup: [14000, 800]
        .map(
          (count, index) =>
            `<article data-video-id="sm${index}"><a href="/watch/sm${index}">動画</a><span title="${count} 再生">${count}</span></article>`,
        )
        .join(""),
    },
  ])(
    "$adapter.id の候補は最低値未満の投稿も集計する",
    async ({ adapter, path, markup }) => {
      history.replaceState({}, "", path);
      document.body.innerHTML = markup;
      const runtime = startContentRuntime(
        new ContentScriptContext("sift-test"),
        adapter,
      );
      try {
        await setFiltering(true);
        await vi.waitFor(async () => {
          await expect(getFilterContext()).resolves.toMatchObject({
            site: adapter.id,
            metricCounts: [14000, 800],
          });
        });
      } finally {
        runtime.dispose();
      }
    },
  );

  it("YouTube のパネル用集計には、最低再生回数で隠れた動画も含める", async () => {
    history.replaceState({}, "", "/@sift/videos");
    document.body.innerHTML = `
      <ytd-browse><button role="tab" aria-selected="true">新しい順</button></ytd-browse>
      <ytd-video-renderer>
        <div id="metadata-line">
          <span class="inline-metadata-item">1.4万回視聴</span>
          <span class="inline-metadata-item">1日前</span>
        </div>
      </ytd-video-renderer>
      <ytd-video-renderer>
        <div id="metadata-line">
          <span class="inline-metadata-item">800回視聴</span>
          <span class="inline-metadata-item">2日前</span>
        </div>
      </ytd-video-renderer>
    `;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      youtubeAdapter,
    );
    await setFiltering(true);

    await vi.waitFor(async () => {
      await expect(getFilterContext()).resolves.toMatchObject({
        site: "youtube",
        metricCounts: [14_000, 800],
        metricCreatedAtMs: expect.arrayContaining([expect.any(Number)]),
      });
    });

    runtime.dispose();
  });

  it("抽出の切替後も、表示に残る投稿を同じ位置に保つ", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await setFiltering(true);
    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLElement>("[data-sift-filter-state]"),
      ).not.toBeNull();
    });

    const cell = document.querySelector<HTMLElement>(
      "[data-testid=cellInnerDiv]",
    );
    if (!cell) {
      throw new Error("テスト用の投稿セルが見つからない");
    }
    vi.spyOn(cell, "getBoundingClientRect").mockImplementation(() => {
      // 抽出を外すと、前に隠れていた投稿がこの投稿の上に加わる想定。
      const top = cell.dataset.siftFilterState ? 48 : 248;
      return new DOMRect(0, top, 600, 180);
    });
    const scrollBy = vi
      .spyOn(window, "scrollBy")
      .mockImplementation(() => undefined);

    await setFiltering(false);

    await vi.waitFor(() => {
      expect(scrollBy).toHaveBeenCalledWith({ top: 200, behavior: "instant" });
    });

    runtime.dispose();
  });
});
