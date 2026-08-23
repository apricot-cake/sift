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
