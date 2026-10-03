import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../../utils/filter-context.ts";
import { defaults, type Settings } from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { TIMELINE_CONTROL } from "../../utils/timeline-controls.ts";
import { SidepanelApp } from "./sidepanel-app.tsx";

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
    metricCounts: [10],
    metricCreatedAtMs: [],
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
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  tab = { id: 1, url: "https://www.youtube.com/@a/videos" };
  request = async () => context("youtube");
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
  it("750msを超える正常応答を定期取得で破棄しない", async () => {
    const slow = deferred<FilterContextResponse>();
    const read = vi.fn(() => slow.promise);
    request = read;
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2250);
    });
    expect(read).toHaveBeenCalledTimes(1);
    slow.resolve(context("youtube"));
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
    old.resolve(context("youtube"));
    await flush();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.siteSettings.youtube.minCountEnabled).toBe(true);
    expect(writes[0]?.siteSettings.x.minReactionsEnabled).toBe(false);
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
    old.resolve(context("youtube"));
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
    expect(writes).toHaveLength(1);
    expect(writes[0]?.siteSettings.youtube.minCountEnabled).toBe(true);
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
      .mockResolvedValue(context("youtube"));
    request = read;
    await mount();
    await fakeBrowser.tabs.onUpdated.trigger(
      1,
      { status: "loading" },
      { ...tab },
    );
    await flush();
    old.resolve(context("niconico"));
    await flush();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.siteSettings.niconico.minCountEnabled).toBe(true);
  });
  it("破棄後の遅い応答で設定を書き換えない", async () => {
    const old = deferred<FilterContextResponse>();
    request = () => old.promise;
    await mount();
    await act(async () => root.unmount());
    root = createRoot(container);
    old.resolve(context("youtube"));
    await flush();
    expect(writes).toHaveLength(0);
  });
});
