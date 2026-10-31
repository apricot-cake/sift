import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../../utils/filter-context.ts";
import { t } from "../../utils/i18n.ts";
import { checkPanelBuild } from "../../utils/local-build-reload.ts";
import {
  type LoadMoreResponse,
  PANEL_CANCEL_LOAD,
  PANEL_LOAD_MORE,
} from "../../utils/panel-load-more.ts";
import type { PanelPost } from "../../utils/panel-post.ts";
import {
  defaults,
  type Settings,
  settingsFor,
  withSiteSettings,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { SIDE_PANEL_CONTROL } from "../../utils/sidepanel-controls.ts";
import { SidepanelApp } from "./sidepanel-app.tsx";

vi.mock("../../utils/local-build-reload.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../utils/local-build-reload.ts")
  >()),
  checkPanelBuild: vi.fn(async () => true),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function context(site: FilterContextResponse["site"]): FilterContextResponse {
  return {
    site,
    pageTitle: site,
    pageKey: site,
    timelineAvailable: true,
    posts: [],
    collectedCount: 0,
    collectionTruncated: false,
  };
}
function post(id: number, text = "投稿の本文"): PanelPost {
  return {
    id: String(id),
    url: `https://x.com/example/status/${id}`,
    author: "投稿者",
    handle: "example",
    text,
    images: [],
    metricCount: 10,
  };
}

function postsContext(posts: readonly PanelPost[], total = posts.length) {
  return { ...context("x"), posts, collectedCount: total };
}
let root: Root;
let container: HTMLElement;
let tab: { id: number; url: string };
let request: (id: number) => Promise<FilterContextResponse | null>;
const writes: Settings[] = [];
async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
function postsPane() {
  const pane = container.querySelector<HTMLDivElement>("[data-posts-panel]");
  if (!pane) throw Error("投稿タブがありません");
  Object.defineProperties(pane, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 300 },
  });
  return pane;
}
async function requestMore() {
  const pane = postsPane();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    pane.scrollTop = 650;
    pane.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
  });
  await flush();
}
async function mount(openFilters = true) {
  await act(async () => {
    root.render(<SidepanelApp />);
  });
  await flush();
  if (openFilters) {
    await act(async () =>
      container.querySelector<HTMLElement>("[data-panel-tab=filters]")?.click(),
    );
  }
}
beforeEach(() => {
  vi.mocked(checkPanelBuild).mockResolvedValue(true);
  vi.mocked(checkPanelBuild).mockClear();
  history.replaceState(null, "", "/sidepanel.html?tabId=1");
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  tab = { id: 1, url: "https://x.com/a" };
  request = async () => context("x");
  writes.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(fakeBrowser.tabs, "query").mockImplementation(
    async () => [{ ...tab }] as never,
  );
  vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation(
    async (id, message) =>
      (message as { type: string }).type === FILTER_CONTEXT_REQUEST
        ? request(id)
        : undefined,
  );
  vi.spyOn(settingsItem, "getValue").mockResolvedValue(defaults);
  vi.spyOn(settingsItem, "setValue").mockImplementation(async (value) => {
    writes.push(value);
  });
  vi.spyOn(settingsItem, "watch").mockReturnValue(() => {});
});

describe("パネルの投稿一覧", () => {
  it("タブを矢印・Home・Endで切り替え、選択中のタブだけTab移動の対象にする", async () => {
    await mount(false);
    const posts = container.querySelector<HTMLButtonElement>(
      "[data-panel-tab=posts]",
    );
    const filters = container.querySelector<HTMLButtonElement>(
      "[data-panel-tab=filters]",
    );
    const press = async (node: HTMLButtonElement | null, key: string) => {
      await act(async () => {
        node?.focus();
        node?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    };
    expect(posts?.tabIndex).toBe(0);
    expect(filters?.tabIndex).toBe(-1);
    await press(posts, "ArrowRight");
    expect(filters?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(filters);
    expect(posts?.tabIndex).toBe(-1);
    expect(filters?.tabIndex).toBe(0);
    await press(filters, "ArrowRight");
    expect(document.activeElement).toBe(posts);
    await press(posts, "End");
    expect(document.activeElement).toBe(filters);
    await press(filters, "Home");
    expect(document.activeElement).toBe(posts);
    expect(checkPanelBuild).toHaveBeenCalledOnce();
    const postsPane =
      container.querySelector<HTMLElement>("[data-posts-panel]");
    expect(posts?.getAttribute("aria-controls")).toBe(postsPane?.id);
    expect(postsPane?.getAttribute("aria-labelledby")).toBe(posts?.id);
  });

  it("タブの往復で追加表示と各タブのスクロール位置を維持する", async () => {
    request = async () =>
      postsContext(Array.from({ length: 51 }, (_, index) => post(index + 1)));
    await mount(false);
    await requestMore();
    const postsPane =
      container.querySelector<HTMLDivElement>("[data-posts-panel]");
    const filtersPane = container.querySelector<HTMLDivElement>(
      "[data-filter-panel]",
    );
    if (!postsPane || !filtersPane) throw Error("タブの内容がありません");
    postsPane.scrollTop = 340;
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-panel-tab=filters]")
        ?.click(),
    );
    expect(postsPane.hidden).toBe(true);
    expect(container.querySelector("[data-post-id='51']")).not.toBeNull();
    postsPane.scrollTop = 0;
    filtersPane.scrollTop = 120;
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-panel-tab=posts]")
        ?.click(),
    );
    expect(postsPane.hidden).toBe(false);
    expect(postsPane.scrollTop).toBe(340);
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(51);
    filtersPane.scrollTop = 0;
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-panel-tab=filters]")
        ?.click(),
    );
    expect(filtersPane.scrollTop).toBe(120);
  });

  it("条件タブから現在のサイトの設定をリセットする", async () => {
    await mount(true);
    writes.length = 0;
    await act(async () =>
      container.querySelector<HTMLButtonElement>("footer button")?.click(),
    );
    await flush();
    const dialog = container.querySelector<HTMLDialogElement>("dialog");
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain(
      t("optionsResetSiteConfirm", { site: "X" }),
    );
    await act(async () =>
      dialog?.querySelector<HTMLButtonElement>("button:last-child")?.click(),
    );
    await flush();
    expect(dialog?.open).toBe(false);
    expect(writes.at(-1)?.siteSettings.x?.minReactionsEnabled).toBe(true);
  });

  it("未接続でも全サイトの設定をリセットできる", async () => {
    request = async () => null;
    vi.spyOn(fakeBrowser.runtime, "sendMessage").mockResolvedValue(undefined);
    await mount(false);
    expect(container.querySelector("[role=tablist]")).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("footer button")?.click(),
    );
    await flush();
    const dialog = container.querySelector<HTMLDialogElement>("dialog");
    expect(dialog?.textContent).toContain(t("optionsResetNoSite"));
    const reset = dialog?.querySelector<HTMLButtonElement>("button:last-child");
    expect(reset?.disabled).toBe(true);
    await act(async () =>
      dialog?.querySelector<HTMLInputElement>("input[type=checkbox]")?.click(),
    );
    await flush();
    expect(reset?.disabled).toBe(false);
    await act(async () => reset?.click());
    await flush();
    expect(writes).toHaveLength(1);
    expect(settingsFor(writes[0] ?? defaults, "x")).toEqual(
      settingsFor(defaults, "x"),
    );
    expect(settingsFor(writes[0] ?? defaults, "bluesky")).toEqual(
      settingsFor(defaults, "bluesky"),
    );
  });
  it("いいね数を取得できなくても最低値の条件を解除できる", async () => {
    let onSettingsChange = (_value: Settings) => {};
    vi.mocked(settingsItem.watch).mockImplementation((callback) => {
      onSettingsChange = (value) => callback(value, defaults);
      return () => {};
    });
    request = async () => ({
      ...postsContext([], 1),
      health: {
        state: "unreadable",
        issue: "metrics",
        sampledPosts: 1,
        readableMetrics: 0,
      },
    });
    await mount(true);
    await act(async () =>
      onSettingsChange(
        withSiteSettings(defaults, "x", {
          ...settingsFor(defaults, "x"),
          minReactionsEnabled: true,
          minReactions: 100,
        }),
      ),
    );
    expect(container.querySelector("[data-minimum-group]")).not.toBeNull();
    expect(
      container.querySelector<HTMLFieldSetElement>("fieldset")?.disabled,
    ).toBe(false);
    expect(container.textContent).toContain(t("sidepanelMetricUnavailable"));
    await act(async () =>
      onSettingsChange(
        withSiteSettings(defaults, "x", {
          ...settingsFor(defaults, "x"),
          minReactionsEnabled: false,
        }),
      ),
    );
    expect(container.textContent).not.toContain(
      t("sidepanelMetricUnavailable"),
    );
  });

  it("初期状態で投稿タブを選び、投稿へのリンクを表示する", async () => {
    request = async () => postsContext([post(1), post(2)], 1000);
    await mount(false);
    expect(
      container
        .querySelector("[data-panel-tab=posts]")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container.querySelector<HTMLDivElement>("[data-filter-panel]")?.hidden,
    ).toBe(true);
    const link = container.querySelector<HTMLAnchorElement>("[data-post-link]");
    expect(link?.href).toBe("https://x.com/example/status/1");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noreferrer");
    expect(link?.textContent).toContain("投稿の本文");
    const postsTab = container.querySelector("[data-panel-tab=posts]");
    expect(postsTab?.getAttribute("aria-label")).toBe(t("sidepanelPostsTab"));
    expect(postsTab?.textContent).toBe(t("sidepanelPostsTab"));
    expect(postsTab?.querySelector("[data-post-count]")).toBeNull();
    const counts = container.querySelector("[data-panel-counts]");
    expect(counts?.getAttribute("role")).toBe("status");
    expect(counts?.getAttribute("aria-live")).toBe("polite");
    expect(counts?.querySelector("[data-post-count]")?.textContent).toBe(
      t("sidepanelMatchingCount", { count: "2" }),
    );
    const pane = container.querySelector("[data-posts-panel]");
    const filters = container.querySelector("[data-filter-panel]");
    const total = counts?.querySelector("[data-collected-count]");
    expect(total?.textContent).toBe(
      t("sidepanelCollectedCount", { count: (1000).toLocaleString() }),
    );
    expect(counts?.closest('[role="tabpanel"]')).toBeNull();
    expect(counts?.parentElement).toBe(pane?.parentElement);
    expect(counts?.parentElement).toBe(filters?.parentElement);
    expect(
      pane &&
        counts &&
        Boolean(
          pane.compareDocumentPosition(counts) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    ).toBe(true);
    expect(
      filters &&
        counts &&
        Boolean(
          filters.compareDocumentPosition(counts) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    ).toBe(true);
  });

  it("投稿本文を文字として表示し、画像は遅延読み込みする", async () => {
    request = async () =>
      postsContext([
        {
          ...post(1, '<img id="injected" src=x onerror="alert(1)">'),
          images: [
            { url: "https://pbs.twimg.com/media/example.jpg", alt: "作品" },
          ],
          metricCount: null,
        },
      ]);
    await mount(false);
    expect(container.querySelector("#injected")).toBeNull();
    expect(container.querySelector("[data-post-link]")?.textContent).toContain(
      '<img id="injected"',
    );
    const image = container.querySelector<HTMLImageElement>(
      "[data-post-link] img",
    );
    expect(image?.alt).toBe("作品");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.textContent).toContain(t("sidepanelLikesUnknown"));
    const media = container.querySelector("[data-post-media]");
    const body = [...container.querySelectorAll("[data-post-link] p")].find(
      (node) => node.textContent?.startsWith('<img id="injected"'),
    );
    expect(
      media &&
        body &&
        Boolean(
          media.compareDocumentPosition(body) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    ).toBe(true);
  });

  it("画像を取得できない場合は案内を表示し、画像URLが更新されたら読み直す", async () => {
    const sample = {
      ...post(1),
      images: [{ url: "https://pbs.twimg.com/media/first.jpg", alt: "作品" }],
    };
    request = async () => postsContext([sample]);
    await mount(false);
    await act(async () =>
      container
        .querySelector<HTMLImageElement>("[data-post-media] img")
        ?.dispatchEvent(new Event("error")),
    );
    expect(
      container.querySelector("[data-post-image-error]")?.textContent,
    ).toContain(t("sidepanelImageUnavailable"));
    request = async () =>
      postsContext([
        {
          ...sample,
          images: [
            { url: "https://pbs.twimg.com/media/second.jpg", alt: "作品" },
          ],
        },
      ]);
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.querySelector("[data-post-image-error]")).toBeNull();
    expect(
      container.querySelector<HTMLImageElement>("[data-post-media] img")?.src,
    ).toBe("https://pbs.twimg.com/media/second.jpg");
  });

  it("大量の投稿を50件ずつ表示する", async () => {
    request = async () =>
      postsContext(Array.from({ length: 101 }, (_, index) => post(index + 1)));
    await mount(false);
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(50);
    await requestMore();
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(100);
    await requestMore();
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(101);
    expect(container.querySelector("[data-show-more-posts]")).toBeNull();
  });

  it("画像表示で一覧キーが一時的に不明になっても追加表示を保つ", async () => {
    let snapshot: FilterContextResponse = {
      ...postsContext(
        Array.from({ length: 51 }, (_, index) => post(index + 1)),
      ),
      pageKey: tab.url,
      timelineKey: "home:following",
    };
    request = async () => snapshot;
    await mount(false);
    await requestMore();
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(51);
    snapshot = { ...snapshot, timelineKey: null };
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.querySelector("[data-post-id='51']")).not.toBeNull();
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(51);
    snapshot = { ...snapshot, timelineKey: "home:following" };
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(51);
  });

  it("未取得と条件に合わない場合を区別する", async () => {
    request = async () => postsContext([]);
    await mount(false);
    expect(container.textContent).toContain(t("sidepanelNoCollectedPosts"));
    const counts = container.querySelector("[data-panel-counts]");
    const matching = counts?.querySelector("[data-post-count]");
    expect(matching?.textContent).toBe(
      t("sidepanelMatchingCount", { count: "0" }),
    );
    expect(container.querySelector("[data-collected-count]")?.textContent).toBe(
      t("sidepanelCollectedCount", { count: "0" }),
    );
    request = async () => postsContext([], 3);
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.textContent).toContain(t("sidepanelNoMatchingPosts"));
    expect(container.textContent).not.toContain(t("sidepanelNoCollectedPosts"));
    expect(matching?.textContent).toBe(
      t("sidepanelMatchingCount", { count: "0" }),
    );
    expect(container.querySelector("[data-collected-count]")?.textContent).toBe(
      t("sidepanelCollectedCount", { count: "3" }),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-panel-tab=filters]")
        ?.click(),
    );
    request = async () => postsContext([post(1), post(2)], 5);
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(matching?.textContent).toBe(
      t("sidepanelMatchingCount", { count: "2" }),
    );
    expect(counts?.closest("[hidden]")).toBeNull();
    const total = container.querySelector("[data-collected-count]");
    expect(total?.textContent).toBe(
      t("sidepanelCollectedCount", { count: "5" }),
    );
    expect(
      total?.closest("[data-posts-panel], [data-filter-panel]"),
    ).toBeNull();
    expect(
      container.querySelector<HTMLElement>("[data-posts-panel]")?.hidden,
    ).toBe(true);
    expect(
      [...container.querySelectorAll('[data-panel-tabs] [role="tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual([t("sidepanelPostsTab"), t("sidepanelFilterConditions")]);
  });

  it("保存した条件で一覧を取り直し、保存前の遅い応答を破棄する", async () => {
    const old = deferred<FilterContextResponse>();
    const read = vi
      .fn()
      .mockResolvedValueOnce(postsContext([post(1)]))
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(postsContext([post(2)], 2));
    request = read;
    await mount(false);
    await act(async () => vi.advanceTimersByTimeAsync(750));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          `button[aria-label="${t("optionsHideReplies")}"]`,
        )
        ?.click(),
    );
    await flush();
    expect(writes.at(-1)?.siteSettings.x?.hideReplies).toBe(true);
    expect(
      container.querySelector("[data-post-id]")?.getAttribute("data-post-id"),
    ).toBe("2");
    old.resolve(postsContext([post(1)]));
    await flush();
    expect(
      container.querySelector("[data-post-id]")?.getAttribute("data-post-id"),
    ).toBe("2");
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("投稿の追加読み込み", () => {
  function respond(load: () => Promise<LoadMoreResponse>) {
    vi.mocked(fakeBrowser.tabs.sendMessage).mockImplementation(
      async (id, message) => {
        const type = (message as { type?: string }).type;
        if (type === FILTER_CONTEXT_REQUEST) return request(id);
        if (type === PANEL_LOAD_MORE) return load();
        return undefined;
      },
    );
  }
  function sent(type: string) {
    return vi
      .mocked(fakeBrowser.tabs.sendMessage)
      .mock.calls.filter(
        ([, message]) => (message as { type?: string }).type === type,
      );
  }
  async function clickRetry() {
    const button = container.querySelector<HTMLButtonElement>(
      "[data-load-more-posts]",
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    await flush();
  }
  async function scroll(pane: HTMLDivElement, top: number, user = false) {
    await act(async () => {
      if (user) pane.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
      pane.scrollTop = top;
      pane.dispatchEvent(new Event("scroll"));
    });
    await flush();
  }

  function shortPane() {
    const pane = postsPane();
    Object.defineProperty(pane, "scrollHeight", {
      configurable: true,
      value: 300,
    });
    pane.scrollTop = 0;
    return pane;
  }

  it("スクロールできない一覧でも下ホイールで取得し、上向きや横方向では取得しない", async () => {
    request = async () => postsContext([post(1)]);
    respond(async () => ({ status: "loaded", added: 1 }));
    await mount(false);
    const pane = shortPane();
    expect(container.querySelector("[data-load-more-hint]")).not.toBeNull();
    expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    await act(async () => {
      pane.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
      pane.dispatchEvent(new WheelEvent("wheel", { deltaX: 100 }));
    });
    await flush();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
    await act(async () => {
      pane.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    });
    await flush();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    expect(pane.scrollTop).toBe(0);
  });

  it("ホイールの慣性が続いても1回だけ取得し、次の操作で再開する", async () => {
    request = async () => postsContext([post(1)]);
    respond(async () => ({ status: "loaded", added: 1 }));
    await mount(false);
    const pane = shortPane();
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
        pane.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
      });
      await flush();
    }
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    await act(async () => {
      pane.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    });
    await flush();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
  });

  it.each(["ArrowDown", "PageDown", "End", " "])(
    "短い一覧でも%sキーで取得し、長押しでは繰り返さない",
    async (key) => {
      request = async () => postsContext([post(1)]);
      respond(async () => ({ status: "loaded", added: 1 }));
      await mount(false);
      const pane = shortPane();
      await act(async () => {
        pane.dispatchEvent(new KeyboardEvent("keydown", { key }));
      });
      await flush();
      expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
      await act(async () => {
        pane.dispatchEvent(new KeyboardEvent("keydown", { key, repeat: true }));
      });
      await flush();
      expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
      await act(async () => {
        pane.dispatchEvent(new KeyboardEvent("keyup", { key }));
        pane.dispatchEvent(new KeyboardEvent("keydown", { key }));
      });
      await flush();
      expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
    },
  );

  it("修飾キー付きの操作やボタン上のSpaceでは追加取得しない", async () => {
    request = async () => postsContext([post(1)]);
    respond(async () => ({ status: "loaded", added: 1 }));
    await mount(false);
    const pane = shortPane();
    const control = document.createElement("button");
    pane.append(control);
    await act(async () => {
      pane.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", shiftKey: true }),
      );
      pane.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", ctrlKey: true }),
      );
      pane.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true }),
      );
      pane.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageDown", metaKey: true }),
      );
      control.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    await flush();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
    control.remove();
  });

  it("タッチの上スワイプだけで取得し、同じ指操作では繰り返さない", async () => {
    request = async () => postsContext([post(1)]);
    respond(async () => ({ status: "loaded", added: 1 }));
    await mount(false);
    const pane = shortPane();
    const touch = async (type: string, x: number, y: number) => {
      const event = new Event(type);
      Object.defineProperty(event, "touches", {
        value: [{ identifier: 1, clientX: x, clientY: y }],
      });
      await act(async () => pane.dispatchEvent(event));
      await flush();
    };
    await touch("touchstart", 100, 200);
    await touch("touchmove", 100, 260);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
    await touch("touchstart", 100, 200);
    await touch("touchmove", 200, 190);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
    await touch("touchstart", 100, 200);
    await touch("touchmove", 100, 150);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    await touch("touchmove", 100, 90);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    await touch("touchstart", 100, 200);
    await touch("touchmove", 100, 150);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
  });

  it("末尾の下ホイールで所有タブへ1要求を送り、読み込み中の操作を重ねない", async () => {
    request = async () => postsContext([post(1)]);
    const pending = deferred<LoadMoreResponse>();
    respond(() => pending.promise);
    await mount(false);
    await requestMore();
    expect(sent(PANEL_LOAD_MORE)).toEqual([
      [1, { type: PANEL_LOAD_MORE, pageKey: "x", timelineKey: null }],
    ]);
    expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    expect(container.querySelector("[data-show-more-posts]")).toBeNull();
    const status = container.querySelector("[data-load-more-status]");
    expect(status?.textContent).toBe(t("sidepanelLoadLoading"));
    expect(status?.classList.contains("sr-only")).toBe(false);
    await requestMore();
    const pane = postsPane();
    await scroll(pane, 650, true);
    await scroll(pane, 690, true);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    request = async () => postsContext([post(1), post(2)]);
    pending.resolve({ status: "loaded", added: 1 });
    await flush();
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(2);
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-status"),
    ).toBe("loaded");
    expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    expect(container.querySelector("[data-load-more-hint]")).not.toBeNull();
    expect(container.querySelector("[data-load-more-status]")).toBe(status);
    expect(status?.textContent).toBe(t("sidepanelLoadLoaded", { count: 1 }));
  });

  it("読み込み完了後は、次のホイール操作で続きを要求できる", async () => {
    request = async () => postsContext([post(1)]);
    respond(async () => ({ status: "loaded", added: 2 }));
    await mount(false);
    await requestMore();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    await requestMore();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
  });

  it("追加取得で50件を超えても進行・完了状態を残し、取得済みの残りを展開できる", async () => {
    let posts = Array.from({ length: 49 }, (_, index) => post(index + 1));
    request = async () => postsContext(posts);
    const pending = deferred<LoadMoreResponse>();
    respond(() => pending.promise);
    await mount(false);
    expect(
      container
        .querySelector("[data-load-request-count]")
        ?.getAttribute("data-load-request-count"),
    ).toBe("0");
    await requestMore();
    posts = Array.from({ length: 60 }, (_, index) => post(index + 1));
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(50);
    expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    expect(container.querySelector("[data-show-more-posts]")).toBeNull();
    expect(
      container
        .querySelector("[data-load-request-count]")
        ?.getAttribute("data-load-request-count"),
    ).toBe("1");
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-status"),
    ).toBe("loading");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === t("sidepanelLoadCancel"),
      ),
    ).toBe(true);
    pending.resolve({ status: "loaded", added: 11 });
    await flush();
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-status"),
    ).toBe("loaded");
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-added"),
    ).toBe("11");
    expect(container.querySelector("[data-load-more-hint]")).not.toBeNull();
    await requestMore();
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(60);
    expect(container.querySelector("[data-show-more-posts]")).toBeNull();
    expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-status"),
    ).toBe("loaded");
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-request-count"),
    ).toBe("1");
  });

  it("ユーザーの下スクロールが末尾へ近づいた時だけ読み込み、結果の描画では連続しない", async () => {
    let posts = [post(1)];
    request = async () => postsContext(posts);
    respond(async () => {
      posts = [...posts, post(posts.length + 1)];
      return { status: "loaded", added: 1 };
    });
    await mount(false);
    const pane = postsPane();
    await act(async () => vi.advanceTimersByTimeAsync(2250));
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
    await scroll(pane, 600);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
    await scroll(pane, 610, true);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(2);
    await scroll(pane, 630);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    await scroll(pane, 650, true);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
  });

  it("ホイール操作から800ms経過後のプログラムスクロールでは取得しない", async () => {
    request = async () => postsContext([post(1)]);
    respond(async () => ({ status: "loaded", added: 1 }));
    await mount(false);
    const pane = postsPane();
    await act(async () => {
      pane.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
      await vi.advanceTimersByTimeAsync(800);
    });
    await scroll(pane, 650);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
    await scroll(pane, 670, true);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
  });

  it("長いスクロールバードラッグ中も操作意図を更新し、単なるマウス移動では取得しない", async () => {
    request = async () => postsContext([post(1)]);
    respond(async () => ({ status: "loaded", added: 1 }));
    await mount(false);
    const pane = postsPane();
    await act(async () => {
      pane.dispatchEvent(new PointerEvent("pointerdown", { buttons: 1 }));
      await vi.advanceTimersByTimeAsync(1000);
      pane.dispatchEvent(new PointerEvent("pointermove", { buttons: 0 }));
    });
    await scroll(pane, 600);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
    await act(async () => {
      pane.dispatchEvent(new PointerEvent("pointermove", { buttons: 1 }));
    });
    await scroll(pane, 650);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
  });

  it("中止後も処理が完了するまで再取得せず、旧応答後は再開できる", async () => {
    request = async () => postsContext([post(1)]);
    const pending = deferred<LoadMoreResponse>();
    const load = vi
      .fn<() => Promise<LoadMoreResponse>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ status: "loaded", added: 1 });
    respond(load);
    await mount(false);
    await requestMore();
    const cancel = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === t("sidepanelLoadCancel"));
    expect(cancel).toBeDefined();
    await act(async () => cancel?.click());
    await flush();
    expect(sent(PANEL_CANCEL_LOAD)).toHaveLength(1);
    expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    await requestMore();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    pending.resolve({ status: "cancelled", added: 0 });
    await flush();
    expect(
      container.querySelector<HTMLButtonElement>("[data-load-more-posts]")
        ?.disabled,
    ).toBe(false);
    await clickRetry();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-status"),
    ).toBe("loaded");
  });

  it("取得中に条件タブへ切り替えると中止し、遅い応答で投稿タブを更新しない", async () => {
    request = async () => postsContext([post(1)]);
    const pending = deferred<LoadMoreResponse>();
    respond(() => pending.promise);
    await mount(false);
    await requestMore();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-panel-tab=filters]")
        ?.click(),
    );
    await flush();
    expect(sent(PANEL_CANCEL_LOAD)).toEqual([[1, { type: PANEL_CANCEL_LOAD }]]);
    expect(
      container.querySelector<HTMLElement>("[data-posts-panel]")?.hidden,
    ).toBe(true);
    pending.resolve({ status: "loaded", added: 20 });
    await flush();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-panel-tab=posts]")
        ?.click(),
    );
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-status"),
    ).toBe("cancelled");
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
  });

  it("追加投稿なしで止まった後はスクロールで再試行せず、ボタンで再試行する", async () => {
    request = async () => postsContext([post(1)]);
    const load = vi
      .fn<() => Promise<LoadMoreResponse>>()
      .mockResolvedValueOnce({ status: "no-progress", added: 0 })
      .mockResolvedValueOnce({ status: "loaded", added: 1 });
    respond(load);
    await mount(false);
    await requestMore();
    expect(container.textContent).toContain(t("sidepanelLoadNoProgress"));
    const retryButton = container.querySelector("[data-load-more-posts]");
    const explanation = container.querySelector("[data-load-more-status]");
    expect(explanation?.classList.contains("sr-only")).toBe(false);
    expect(explanation?.closest("button")).toBeNull();
    expect(retryButton?.getAttribute("aria-describedby")).toBe(explanation?.id);
    expect(retryButton?.querySelector("[data-load-more-summary]")).toBeNull();
    const pane = postsPane();
    await scroll(pane, 650, true);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    expect(container.querySelector("[data-load-more-posts]")?.textContent).toBe(
      t("sidepanelLoadRetry"),
    );
    await clickRetry();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
    expect(
      container
        .querySelector("[data-load-more-status]")
        ?.getAttribute("data-status"),
    ).toBe("loaded");
  });

  it.each(["failed", "unsupported", "cancelled"] as const)(
    "%sの後はスクロールで繰り返さず、明示的に再試行できる",
    async (status) => {
      request = async () => postsContext([post(1)]);
      const load = vi
        .fn<() => Promise<LoadMoreResponse>>()
        .mockResolvedValueOnce({ status, added: 0 })
        .mockResolvedValueOnce({ status: "loaded", added: 1 });
      respond(load);
      await mount(false);
      await requestMore();
      expect(
        container.querySelector("[data-load-more-posts]")?.textContent,
      ).toBe(t("sidepanelLoadRetry"));
      expect(container.querySelector("[data-load-more-hint]")).toBeNull();
      await requestMore();
      expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
      await clickRetry();
      expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
      expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    },
  );

  it.each(["loading", "unreadable"] as const)(
    "元の一覧が%sの間は操作で追加取得しない",
    async (state) => {
      request = async () => ({
        ...postsContext([post(1)]),
        health: { state, sampledPosts: 1, readableMetrics: 1 },
      });
      respond(async () => ({ status: "loaded", added: 1 }));
      await mount(false);
      await requestMore();
      expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
      expect(container.querySelector("[data-load-more-posts]")).toBeNull();
      expect(container.querySelector("[data-load-more-hint]")).toBeNull();
    },
  );

  it.each(["limited", "authentication", "limit"] as const)(
    "%sでは再試行ボタンを表示せず、スクロールで繰り返さない",
    async (status) => {
      request = async () => postsContext([post(1)]);
      respond(async () => ({ status, added: 0 }));
      await mount(false);
      await requestMore();
      expect(container.querySelector("[data-load-more-posts]")).toBeNull();
      expect(container.querySelector("[data-load-more-hint]")).toBeNull();
      await scroll(postsPane(), 650, true);
      await requestMore();
      expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    },
  );

  it("再試行ボタンのクリック後に描画でスクロールしても、次の取得を始めない", async () => {
    request = async () => postsContext([post(1)]);
    const load = vi
      .fn<() => Promise<LoadMoreResponse>>()
      .mockResolvedValueOnce({ status: "failed", added: 0 })
      .mockResolvedValue({ status: "loaded", added: 1 });
    respond(load);
    await mount(false);
    await requestMore();
    const retry = container.querySelector<HTMLButtonElement>(
      "[data-load-more-posts]",
    );
    expect(retry).not.toBeNull();
    await act(async () => {
      retry?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          buttons: 1,
          pointerType: "mouse",
        }),
      );
      retry?.click();
    });
    await flush();
    await scroll(postsPane(), 650);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(2);
  });

  it("パネルの空白を押して離した後の描画スクロールでは取得しない", async () => {
    request = async () => postsContext([post(1)]);
    respond(async () => ({ status: "loaded", added: 1 }));
    await mount(false);
    const pane = postsPane();
    await act(async () => {
      pane.dispatchEvent(
        new PointerEvent("pointerdown", { buttons: 1, pointerType: "mouse" }),
      );
      pane.dispatchEvent(
        new PointerEvent("pointerup", { pointerType: "mouse" }),
      );
    });
    await scroll(pane, 650);
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(0);
  });

  it.each(["hidden", "switch", "pagehide", "unmount"])(
    "取得中の%sで元タブへ中止を送り、遅い応答を画面へ反映しない",
    async (change) => {
      request = async () => postsContext([post(1)]);
      const pending = deferred<LoadMoreResponse>();
      respond(() => pending.promise);
      await mount(false);
      await requestMore();
      await act(async () => {
        if (change === "hidden") {
          vi.spyOn(document, "visibilityState", "get").mockReturnValue(
            "hidden",
          );
          document.dispatchEvent(new Event("visibilitychange"));
        } else if (change === "switch") {
          tab = { id: 2, url: "https://x.com/another" };
          await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });
        } else if (change === "pagehide") {
          window.dispatchEvent(new Event("pagehide"));
        } else {
          root.unmount();
          root = createRoot(container);
        }
      });
      await flush();
      expect(sent(PANEL_CANCEL_LOAD)).toEqual([
        [1, { type: PANEL_CANCEL_LOAD }],
      ]);
      pending.resolve({ status: "loaded", added: 20 });
      await flush();
      expect(
        container.querySelector(
          '[data-load-more-status][data-status="loaded"]',
        ),
      ).toBeNull();
      expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
    },
  );

  it("Blueskyでも所有タブから続きを取得し、対象外ページでは操作を表示しない", async () => {
    respond(async () => ({ status: "loaded", added: 1 }));
    request = async () => context("bluesky");
    await mount(false);
    await requestMore();
    expect(sent(PANEL_LOAD_MORE)).toEqual([
      [1, { type: PANEL_LOAD_MORE, pageKey: "bluesky", timelineKey: null }],
    ]);
    request = async () => ({ ...context("x"), timelineAvailable: false });
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.querySelector("[data-load-more-posts]")).toBeNull();
    expect(sent(PANEL_LOAD_MORE)).toHaveLength(1);
  });
});

describe("最低いいね数の直接入力", () => {
  function input() {
    const node = container.querySelector<HTMLInputElement>(
      "[data-minimum-group] input",
    );
    if (!node) throw Error("最低いいね数の入力欄がありません");
    return node;
  }
  async function enter(value: string) {
    await act(async () => {
      input().focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
  }
  it("候補やモード切替を挟まず入力し、解除しても保存値を残す", async () => {
    await mount();
    expect(input().value).toBe("1000");
    expect(container.querySelector("[data-threshold-suggestions]")).toBeNull();
    await enter("234");
    expect(writes.at(-1)?.siteSettings.x).toMatchObject({
      minReactions: 234,
      minReactionsEnabled: true,
    });
    await act(async () => input().blur());
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-minimum-group] button")
        ?.click(),
    );
    await flush();
    expect(input().value).toBe("");
    expect(input().placeholder).toBe(t("optionsMinimumNone"));
    expect(writes.at(-1)?.siteSettings.x).toMatchObject({
      minReactions: 234,
      minReactionsEnabled: false,
    });
    await enter("234");
    expect(writes.at(-1)?.siteSettings.x).toMatchObject({
      minReactions: 234,
      minReactionsEnabled: true,
    });
  });
  it("空欄で解除し、0は有効な最低値として扱う", async () => {
    await mount();
    await enter("");
    expect(writes.at(-1)?.siteSettings.x).toMatchObject({
      minReactions: 1000,
      minReactionsEnabled: false,
    });
    await enter("0");
    expect(writes.at(-1)?.siteSettings.x).toMatchObject({
      minReactions: 0,
      minReactionsEnabled: true,
    });
  });
  it("整数以外を保存せず、範囲外の数値は確定時に範囲内へ収める", async () => {
    await mount();
    writes.length = 0;
    await enter("1.5");
    expect(writes).toHaveLength(0);
    await act(async () => input().blur());
    expect(input().value).toBe("1000");
    await enter("1000000001");
    expect(writes).toHaveLength(0);
    await act(async () => input().blur());
    expect(input().value).toBe("1000000000");
    expect(writes.at(-1)?.siteSettings.x.minReactions).toBe(1_000_000_000);
  });
});

describe("サイト別条件の記憶", () => {
  const saved: Settings = {
    siteSettings: {
      x: {
        ...defaults.siteSettings.x,
        minReactionsEnabled: true,
        minReactions: 321,
        mediaEnabled: true,
        mediaMode: "images",
        hideReplies: true,
        hideQuotes: false,
        hideReposts: false,
      },
      bluesky: {
        ...defaults.siteSettings.bluesky,
        minReactionsEnabled: true,
        minReactions: 654,
        mediaEnabled: true,
        mediaMode: "video",
        hideReplies: false,
        hideQuotes: true,
        hideReposts: true,
      },
    },
  };
  function expectSavedConditions(site: "x" | "bluesky") {
    const conditions = saved.siteSettings[site];
    expect(
      container.querySelector<HTMLInputElement>("[data-minimum-group] input")
        ?.value,
    ).toBe(String(conditions.minReactions));
    expect(
      container.querySelector(
        `[role="combobox"][aria-label="${t("optionsMedia")}"]`,
      )?.textContent,
    ).toBe(t(site === "x" ? "optionsMediaImages" : "optionsMediaVideo"));
    for (const [label, enabled] of [
      ["optionsHideReplies", conditions.hideReplies],
      ["optionsHideQuotes", conditions.hideQuotes],
      ["optionsHideReposts", conditions.hideReposts],
    ] as const)
      expect(
        container
          .querySelector(`[role="switch"][aria-label="${t(label)}"]`)
          ?.getAttribute("aria-checked"),
      ).toBe(String(enabled));
    expect(writes).toHaveLength(0);
  }

  it("保存済みの最低いいね数・種別・除外条件を開き直しや別タブ起動でも維持する", async () => {
    vi.mocked(settingsItem.getValue).mockResolvedValue(saved);
    await mount();
    expectSavedConditions("x");
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expectSavedConditions("x");
    await act(async () => {
      await fakeBrowser.runtime.onMessage.trigger(
        { type: SIDE_PANEL_CONTROL.setPanelTab, tabId: 1 },
        {},
        () => {},
      );
    });
    await flush();
    expectSavedConditions("x");
    await act(async () => root.unmount());
    root = createRoot(container);
    history.replaceState(null, "", "/sidepanel.html?tabId=2");
    tab = { id: 2, url: "https://x.com/another" };
    await mount();
    expectSavedConditions("x");
  });

  it("同じタブでサイトを往復しても、それぞれの保存条件を独立して復元する", async () => {
    vi.mocked(settingsItem.getValue).mockResolvedValue(saved);
    await mount();
    expectSavedConditions("x");
    for (const site of ["bluesky", "x"] as const) {
      tab.url =
        site === "x"
          ? "https://x.com/another"
          : "https://bsky.app/profile/example.test";
      request = async () => context(site);
      await act(async () => {
        await fakeBrowser.tabs.onUpdated.trigger(1, { url: tab.url }, {
          ...tab,
        } as never);
      });
      await flush();
      expectSavedConditions(site);
    }
  });

  it("コンテンツ処理への再接続後も保存済み条件を維持する", async () => {
    vi.mocked(settingsItem.getValue).mockResolvedValue(saved);
    request = async () => null;
    const reconnect = vi
      .spyOn(fakeBrowser.runtime, "sendMessage")
      .mockImplementation(async (message) => {
        if (
          (message as { type?: string }).type === SIDE_PANEL_CONTROL.connectTab
        )
          request = async () => context("x");
        return undefined;
      });
    await mount();
    expect(reconnect).toHaveBeenCalledWith({
      type: SIDE_PANEL_CONTROL.connectTab,
      tabId: 1,
    });
    expectSavedConditions("x");
  });

  it("明示的なリセットは現在のサイトだけを既定値に戻す", async () => {
    vi.mocked(settingsItem.getValue).mockResolvedValue(saved);
    await mount();
    await act(async () =>
      container.querySelector<HTMLButtonElement>("footer button")?.click(),
    );
    const dialog = container.querySelector<HTMLDialogElement>("dialog");
    expect(dialog?.open).toBe(true);
    await act(async () =>
      dialog?.querySelector<HTMLButtonElement>("button:last-child")?.click(),
    );
    await flush();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.siteSettings.x).toEqual(defaults.siteSettings.x);
    expect(writes[0]?.siteSettings.bluesky).toEqual(saved.siteSettings.bluesky);
  });
});

describe("接続先と非同期応答", () => {
  it("開くときに一度確認し、ページ情報の定期取得では確認しない", async () => {
    await mount();
    expect(checkPanelBuild).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(2250));
    expect(checkPanelBuild).toHaveBeenCalledOnce();
  });

  it("起動時に新版を検知したら設定を書き換えない", async () => {
    vi.mocked(checkPanelBuild).mockResolvedValue(false);
    await mount();
    expect(writes).toHaveLength(0);
  });

  it("操作直前の確認を待ち、新版なら設定を変更しない", async () => {
    await mount();
    writes.length = 0;
    const pending = deferred<boolean>();
    vi.mocked(checkPanelBuild).mockReturnValueOnce(pending.promise);
    const toggle = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${t("optionsHideReplies")}"]`,
    );
    await act(async () => toggle?.click());
    expect(checkPanelBuild).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(0);
    pending.resolve(false);
    await flush();
    expect(writes).toHaveLength(0);
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
  });

  it("更新がなければ確認後に操作し、次の操作でも確認する", async () => {
    await mount();
    writes.length = 0;
    const toggle = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${t("optionsHideReplies")}"]`,
    );
    await act(async () => toggle?.click());
    await flush();
    expect(writes.at(-1)?.siteSettings.x?.hideReplies).toBe(true);
    await act(async () => toggle?.click());
    await flush();
    expect(writes.at(-1)?.siteSettings.x?.hideReplies).toBe(false);
    expect(checkPanelBuild).toHaveBeenCalledTimes(3);
  });

  it("別タブへ引き継がず、元のタブへ戻っても保存済みの条件を書き換えない", async () => {
    await mount();
    expect(writes).toHaveLength(0);
    vi.mocked(fakeBrowser.tabs.sendMessage).mockClear();
    tab = { id: 2, url: "https://x.com/example" };
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(fakeBrowser.tabs.sendMessage).not.toHaveBeenCalledWith(2, {
      type: FILTER_CONTEXT_REQUEST,
    });
    expect(container.querySelector("[data-minimum-group]")).not.toBeNull();
    tab = { id: 1, url: "https://x.com/a" };
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 1, windowId: 1 });
    await flush();
    expect(writes).toHaveLength(0);
    expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: FILTER_CONTEXT_REQUEST,
    });
  });

  it("別タブのパネル起動通知で接続先や保存条件を変更しない", async () => {
    await mount();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: "sift:sidepanel-set-panel-tab", tabId: 2 },
      {},
      () => {},
    );
    await flush();
    expect(writes).toHaveLength(0);
    expect(container.querySelector("[data-minimum-group]")).not.toBeNull();
  });
  it.each(["x", "bluesky"] as const)(
    "%s の対象外ページでは操作項目を表示しない",
    async (site) => {
      tab = {
        id: 1,
        url:
          site === "x"
            ? "https://x.com/Google"
            : "https://bsky.app/profile/example.bsky.social",
      };
      request = async () => ({
        ...context(site),
        timelineAvailable: false,
      });
      await mount();
      expect(container.querySelector("[data-minimum-group]")).toBeNull();
      expect(container.textContent).toContain(t("sidepanelUnsupportedTitle"));
    },
  );
  it("対応を外したFANBOXでは対象外表示にして再接続しない", async () => {
    tab = { id: 1, url: "https://official.fanbox.cc/posts" };
    const read = vi.fn(async () => null);
    request = read;
    const reconnect = vi
      .spyOn(fakeBrowser.runtime, "sendMessage")
      .mockResolvedValue(undefined);
    await mount();
    expect(container.textContent).toContain(t("sidepanelStatusUnavailable"));
    expect(container.textContent).toContain(t("sidepanelSupportedSitesHint"));
    expect(container.querySelector("[data-minimum-group]")).toBeNull();
    expect(read).toHaveBeenCalledOnce();
    expect(reconnect).not.toHaveBeenCalledWith({
      type: SIDE_PANEL_CONTROL.connectTab,
      tabId: 1,
    });
    expect(writes).toHaveLength(0);
  });
  it("750msを超える正常応答を定期取得で破棄しない", async () => {
    const slow = deferred<FilterContextResponse>();
    const read = vi.fn(() => slow.promise);
    request = read;
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2250);
    });
    expect(read).toHaveBeenCalledTimes(1);
    slow.resolve(context("x"));
    await flush();
    expect(writes).toHaveLength(0);
    expect(
      container
        .querySelector("[data-sift-site]")
        ?.getAttribute("data-sift-site"),
    ).toBe("x");
  });
  it("タブ変更後の古い応答は投稿表示に使わず、設定を書き換えない", async () => {
    const old = deferred<FilterContextResponse>();
    request = (id) => (id === 1 ? old.promise : Promise.resolve(context("x")));
    await mount();
    tab = { id: 2, url: "https://x.com/example" };
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });
    await flush();
    old.resolve(context("x"));
    await flush();
    expect(writes).toHaveLength(0);
    expect(fakeBrowser.tabs.sendMessage).not.toHaveBeenCalledWith(2, {
      type: FILTER_CONTEXT_REQUEST,
    });
  });
  it("同じタブのURLが変わった後の応答は反映しない", async () => {
    const old = deferred<FilterContextResponse>();
    request = () => old.promise;
    await mount();
    tab.url = "https://x.com/example";
    old.resolve(context("x"));
    await flush();
    expect(writes).toHaveLength(0);
  });
  it("古い接続失敗を別タブへの切替後に再接続しない", async () => {
    const old = deferred<FilterContextResponse | null>();
    request = (id) => (id === 1 ? old.promise : Promise.resolve(context("x")));
    const connect = vi.spyOn(fakeBrowser.runtime, "sendMessage");
    await mount();
    tab = { id: 2, url: "https://x.com/example" };
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });
    await flush();
    old.resolve(null);
    await flush();
    expect(connect).not.toHaveBeenCalled();
  });
  it("同じURLの再読み込みでも旧文書からの応答を破棄する", async () => {
    const old = deferred<FilterContextResponse>();
    const read = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(context("x"));
    request = read;
    await mount();
    await fakeBrowser.tabs.onUpdated.trigger(1, { status: "loading" }, {
      ...tab,
    } as never);
    await flush();
    old.resolve(context("bluesky"));
    await flush();
    expect(writes).toHaveLength(0);
  });
  it("非表示になる前の応答を破棄し、復帰時は所有タブへ接続する", async () => {
    const old = deferred<FilterContextResponse>();
    const read = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(context("x"));
    request = read;
    await mount();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(read).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    old.resolve(context("bluesky"));
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(0);
    expect(
      container
        .querySelector("[data-sift-site]")
        ?.getAttribute("data-sift-site"),
    ).toBe("x");
  });
  it.each(["unmount", "switch"])(
    "ユーザー設定の保存待ちで%sしても投稿を再取得しない",
    async (change) => {
      tab = { id: 1, url: "https://x.com/example" };
      request = async () => context("x");
      await mount();
      const write = deferred<void>();
      vi.mocked(settingsItem.setValue).mockImplementationOnce(
        () => write.promise,
      );
      const toggle = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${t("optionsHideReplies")}"]`,
      );
      expect(toggle).not.toBeNull();
      await act(async () => toggle?.click());
      if (change === "unmount") {
        await act(async () => root.unmount());
        root = createRoot(container);
      } else {
        tab = { id: 2, url: "https://x.com/example" };
        request = async () => context("x");
        await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });
        await flush();
      }
      vi.mocked(fakeBrowser.tabs.sendMessage).mockClear();
      write.resolve(undefined);
      await flush();
      expect(fakeBrowser.tabs.sendMessage).not.toHaveBeenCalled();
    },
  );
  it("破棄後の遅い応答で設定を書き換えない", async () => {
    const old = deferred<FilterContextResponse>();
    request = () => old.promise;
    await mount();
    await act(async () => root.unmount());
    root = createRoot(container);
    old.resolve(context("x"));
    await flush();
    expect(writes).toHaveLength(0);
  });
});
