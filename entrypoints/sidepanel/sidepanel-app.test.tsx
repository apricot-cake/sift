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
    metricSampleCount: 1,
    metricCounts: [10],
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
async function mount(openFilters = true) {
  await act(async () => {
    root.render(<SidepanelApp />);
  });
  await flush();
  if (openFilters) {
    await act(async () =>
      container.querySelector<HTMLElement>("details summary")?.click(),
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
  it("いいね数を取得できなくても最低値の条件を解除できる", async () => {
    let onSettingsChange = (_value: Settings) => {};
    vi.mocked(settingsItem.watch).mockImplementation((callback) => {
      onSettingsChange = (value) => callback(value, defaults);
      return () => {};
    });
    request = async () => ({
      ...postsContext([], 1),
      metricCounts: [],
      health: {
        state: "unreadable",
        issue: "metrics",
        sampledPosts: 1,
        readableMetrics: 0,
      },
    });
    await mount();
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

  it("条件は初期状態で折りたたみ、投稿へのリンクを表示する", async () => {
    request = async () => postsContext([post(1)]);
    await mount(false);
    expect(container.querySelector("details")?.open).toBe(false);
    const link = container.querySelector<HTMLAnchorElement>("[data-post-link]");
    expect(link?.href).toBe("https://x.com/example/status/1");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noreferrer");
    expect(link?.textContent).toContain("投稿の本文");
    expect(container.querySelector("[data-post-count]")?.textContent).toBe(
      t("sidepanelPostCount", { count: "1", total: "1" }),
    );
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
    await mount();
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
  });

  it("大量の投稿を50件ずつ表示する", async () => {
    request = async () =>
      postsContext(Array.from({ length: 101 }, (_, index) => post(index + 1)));
    await mount();
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(50);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-show-more-posts]")
        ?.click(),
    );
    expect(container.querySelectorAll("[data-post-link]")).toHaveLength(100);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-show-more-posts]")
        ?.click(),
    );
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
    await mount();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-show-more-posts]")
        ?.click(),
    );
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
    await mount();
    expect(container.textContent).toContain(t("sidepanelNoCollectedPosts"));
    request = async () => postsContext([], 3);
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.textContent).toContain(t("sidepanelNoMatchingPosts"));
    expect(container.textContent).not.toContain(t("sidepanelNoCollectedPosts"));
  });

  it("保存した条件で一覧を取り直し、保存前の遅い応答を破棄する", async () => {
    const old = deferred<FilterContextResponse>();
    const read = vi
      .fn()
      .mockResolvedValueOnce(postsContext([post(1)]))
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(postsContext([post(2)], 2));
    request = read;
    await mount();
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
describe("接続先と非同期応答", () => {
  it("開くときに一度確認し、ページ情報の定期取得では確認しない", async () => {
    await mount();
    expect(checkPanelBuild).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(2250));
    expect(checkPanelBuild).toHaveBeenCalledOnce();
  });

  it("起動時に新版を検知したら投稿の取得や設定の初期化をしない", async () => {
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

  it("別タブへ引き継がず、元のタブへ戻っても最低値を初期化し直さない", async () => {
    await mount();
    expect(writes).toHaveLength(1);
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
    expect(writes).toHaveLength(1);
    expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: FILTER_CONTEXT_REQUEST,
    });
  });

  it("別タブのパネル起動通知で接続先や最低値を変更しない", async () => {
    await mount();
    await fakeBrowser.runtime.onMessage.trigger(
      { type: "sift:sidepanel-set-panel-tab", tabId: 2, resetMinimum: true },
      {},
      () => {},
    );
    await flush();
    expect(writes).toHaveLength(1);
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
    expect(writes).toHaveLength(1);
    expect(
      container
        .querySelector("[data-sift-site]")
        ?.getAttribute("data-sift-site"),
    ).toBe("x");
  });
  it("タブ変更後の古い応答は投稿表示や設定の初期化に使わない", async () => {
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
  it("設定の取得中に接続先が変わっても古いサイトを初期化しない", async () => {
    const oldSettings = deferred<Settings>();
    vi.mocked(settingsItem.getValue)
      .mockResolvedValueOnce(defaults)
      .mockImplementationOnce(() => oldSettings.promise);
    await mount();
    tab = { id: 2, url: "https://x.com/example" };
    request = async () => context("x");
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });
    await flush();
    oldSettings.resolve(defaults);
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
    expect(writes).toHaveLength(1);
    expect(writes[0]?.siteSettings.bluesky).toEqual(
      defaults.siteSettings.bluesky,
    );
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
    expect(writes).toHaveLength(1);
    expect(writes[0]?.siteSettings.bluesky).toEqual(
      defaults.siteSettings.bluesky,
    );
    expect(
      container
        .querySelector("[data-sift-site]")
        ?.getAttribute("data-sift-site"),
    ).toBe("x");
  });
  it("非表示中のタブ変更でも保存待ちの初期化を無効にする", async () => {
    const write = deferred<void>();
    vi.mocked(settingsItem.setValue).mockImplementationOnce(
      () => write.promise,
    );
    await mount();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    tab = { id: 2, url: "https://x.com/example" };
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 2, windowId: 1 });
    visibility.mockReturnValue("visible");
    write.resolve(undefined);
    await flush();
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
