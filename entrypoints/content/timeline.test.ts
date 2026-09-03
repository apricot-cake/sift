import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import { blueskyAdapter } from "../../utils/adapters/bluesky.ts";
import { xAdapter } from "../../utils/adapters/x.ts";
import { youtubeAdapter } from "../../utils/adapters/youtube.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../../utils/filter-context.ts";
import { TIMELINE_CONTROL } from "../../utils/timeline-controls.ts";
import { startContentRuntime } from "./index.ts";

const timelineMarkup = `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="tweetPhoto"></div>
      <button data-testid="like" aria-label="1,100 件のいいね"></button>
      <time datetime="2026-08-01T12:00:00.000Z"></time>
    </article>
  </div>
`;

function xPostMarkup(id: string, likes = 0): string {
  return `
    <div data-testid="cellInnerDiv">
      <article data-testid="tweet">
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
  history.replaceState({}, "", "/");
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

  it("Blueskyで連続読み込みの警告が出ても次ページ判定を止めない", async () => {
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

    expect((await getFilterContext()).continuousLoadingWarning).toBe(true);
    scrollTo.mockClear();
    await new Promise((resolve) => window.setTimeout(resolve, 2_500));

    expect((await getFilterContext()).continuousLoadingWarning).toBe(true);
    expect(scrollTo).toHaveBeenCalled();
    expect(
      document.documentElement.hasAttribute("data-sift-layout-probe"),
    ).toBe(true);

    runtime.dispose();
  }, 10_000);

  it("Blueskyがフィードの終端を示した後は読み込み判定を再開しない", async () => {
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

  it("YouTubeの対象外ページへ移るとフィルター状態を消す", async () => {
    history.replaceState({}, "", "/results");
    document.body.innerHTML = `
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
      expect(document.querySelector("[data-sift-filter-state]")).not.toBeNull();
    });

    history.pushState({}, "", "/");
    document.body.append(document.createElement("div"));

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-filter-state]")).toBeNull();
    });

    runtime.dispose();
  });

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
