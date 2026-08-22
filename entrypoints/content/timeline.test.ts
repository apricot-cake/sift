import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import { blueskyAdapter } from "../../utils/adapters/bluesky.ts";
import { xAdapter } from "../../utils/adapters/x.ts";
import { youtubeAdapter } from "../../utils/adapters/youtube.ts";
import { OPEN_LIVE_CONTROLS } from "../../utils/live-controls.ts";
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

const hiddenTimelineMarkup = `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <button data-testid="like" aria-label="0 likes"></button>
      <time datetime="2026-08-01T12:00:00.000Z"></time>
    </article>
  </div>
`;

beforeEach(() => {
  fakeBrowser.reset();
  history.replaceState({}, "", "/");
  document.body.innerHTML = "";
});

describe("タイムラインのフィルター", () => {
  it("投稿を絞り込み、ページ上の操作UIは作らない", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLElement>("[data-sift-filter-state]"),
      ).not.toBeNull();
    });
    expect(document.body.children).toHaveLength(1);

    runtime.dispose();
  });

  it("投稿のない画面には操作UIもフィルター状態も残さない", async () => {
    document.body.innerHTML = '<div data-testid="primaryColumn">settings</div>';
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(document.querySelector("article")).toBeNull();
    });
    expect(document.body.children).toHaveLength(1);
    expect(document.querySelector("[data-sift-filter-state]")).toBeNull();
    expect(document.querySelector("[data-sift-empty-state]")).toBeNull();

    runtime.dispose();
  });

  it("すべての投稿が隠れたときは空状態からフィルターを調整できる", async () => {
    document.body.innerHTML = hiddenTimelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-empty-state]")).not.toBeNull();
    });
    expect(
      document
        .querySelector<HTMLElement>("[data-sift-filter-state]")
        ?.getAttribute("data-sift-filter-state"),
    ).toBe("hidden");

    const sendMessage = vi
      .spyOn(fakeBrowser.runtime, "sendMessage")
      .mockResolvedValue();

    document
      .querySelector<HTMLButtonElement>("[data-sift-open-live-controls]")
      ?.click();

    expect(sendMessage).toHaveBeenCalledWith({ type: OPEN_LIVE_CONTROLS });

    runtime.dispose();
  });

  it("Blueskyの空の専用リストでは画面本体に空状態を出す", async () => {
    history.replaceState({}, "", "/profile/alice.test/lists/abc");
    document.body.innerHTML = '<div data-testid="homeScreen"></div>';
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      blueskyAdapter,
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-empty-state]")).not.toBeNull();
    });
    expect(
      document.querySelector("[data-sift-empty-state]")?.parentElement,
    ).toBe(document.querySelector('[data-testid="homeScreen"]'));

    runtime.dispose();
  });

  it("表示対象の投稿が加わると空状態を消す", async () => {
    document.body.innerHTML = hiddenTimelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-empty-state]")).not.toBeNull();
    });

    document.body.insertAdjacentHTML("beforeend", timelineMarkup);

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-empty-state]")).toBeNull();
      expect(
        document.querySelector<HTMLElement>(
          '[data-sift-filter-state="matched"]',
        ),
      ).not.toBeNull();
    });

    runtime.dispose();
  });

  it("フィルターを無効にすると空状態を消す", async () => {
    document.body.innerHTML = hiddenTimelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-empty-state]")).not.toBeNull();
    });

    await fakeBrowser.runtime.onMessage.trigger(
      { type: TIMELINE_CONTROL.toggleFiltering },
      {},
      () => {},
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-empty-state]")).toBeNull();
      expect(document.querySelector("[data-sift-filter-state]")).toBeNull();
    });

    runtime.dispose();
  });

  it("投稿のない画面へ移ると空状態を消す", async () => {
    document.body.innerHTML = hiddenTimelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-empty-state]")).not.toBeNull();
    });

    document.body.innerHTML = '<div data-testid="primaryColumn">settings</div>';

    await vi.waitFor(() => {
      expect(document.querySelector("[data-sift-empty-state]")).toBeNull();
      expect(document.querySelector("[data-sift-filter-state]")).toBeNull();
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

  it("抽出の切替後も、表示に残る投稿を同じ位置に保つ", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
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

    await fakeBrowser.runtime.onMessage.trigger(
      {
        type: TIMELINE_CONTROL.toggleFiltering,
      },
      {},
      () => {},
    );

    await vi.waitFor(() => {
      expect(scrollBy).toHaveBeenCalledWith({ top: 200, behavior: "instant" });
    });

    runtime.dispose();
  });
});
