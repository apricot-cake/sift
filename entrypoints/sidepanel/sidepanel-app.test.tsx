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
import { defaults, type Settings } from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { TIMELINE_CONTROL } from "../../utils/timeline-controls.ts";
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
    filteringEnabled: false,
    continuousLoadingWarning: false,
    metricSampleCount: 1,
    metricCounts: [10],
  };
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
async function mount() {
  await act(async () => {
    root.render(<SidepanelApp />);
  });
  await flush();
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

  it("起動時に新版を検知したら設定の初期化やフィルター有効化をしない", async () => {
    vi.mocked(checkPanelBuild).mockResolvedValue(false);
    await mount();
    expect(writes).toHaveLength(0);
    expect(fakeBrowser.tabs.sendMessage).not.toHaveBeenCalledWith(1, {
      type: TIMELINE_CONTROL.setFiltering,
      enabled: true,
    });
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
    expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(1, {
      type: TIMELINE_CONTROL.setFiltering,
      enabled: true,
    });
  });
  it("タブ変更後の古い応答は設定の初期化や再有効化に使わない", async () => {
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
    expect(fakeBrowser.tabs.sendMessage).not.toHaveBeenCalledWith(1, {
      type: TIMELINE_CONTROL.setFiltering,
      enabled: true,
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
    expect(fakeBrowser.tabs.sendMessage).not.toHaveBeenCalledWith(1, {
      type: TIMELINE_CONTROL.setFiltering,
      enabled: true,
    });
  });
  it.each(["unmount", "switch"])(
    "ユーザー設定の保存待ちで%sしても有効化を再送しない",
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
      expect(fakeBrowser.tabs.sendMessage).not.toHaveBeenCalledWith(
        expect.any(Number),
        { type: TIMELINE_CONTROL.setFiltering, enabled: true },
      );
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
