import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  action: { onClicked: { addListener: vi.fn() } },
  runtime: {
    onMessage: { addListener: vi.fn() },
    getURL: (path: string) => `chrome-extension://test${path}`,
    onInstalled: { addListener: vi.fn() },
    sendMessage: vi.fn(async () => undefined),
  },
  storage: {
    session: {
      set: vi.fn(async () => undefined),
      get: vi.fn(
        async (): Promise<Record<string, unknown>> => ({
          "sift:sidepanel-tab-id": 7,
          "sift:sidepanel-origin:7": "https://x.com",
        }),
      ),
      remove: vi.fn(async () => undefined),
    },
  },
  sidePanel: {
    setOptions: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    onOpened: { addListener: vi.fn() },
    onClosed: { addListener: vi.fn() },
  },
  tabs: {
    onUpdated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
    sendMessage: vi.fn(async () => ({
      site: "youtube",
      timelineAvailable: false,
    })),
    query: vi.fn(async () => []),
    get: vi.fn(async () => ({
      id: 7,
      active: false,
      url: "https://example.com/",
    })),
  },
  scripting: {
    insertCSS: vi.fn(async () => undefined),
    executeScript: vi.fn(async () => undefined),
  },
}));
vi.mock("wxt/browser", () => ({ browser: api }));
vi.mock("../utils/filter-context.ts", () => ({
  FILTER_CONTEXT_REQUEST: "sift:get-filter-context",
  isFilterContextResponse: () => true,
}));

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", false);
  const background = await import("../entrypoints/background.ts");
  background.default.main();
});

it("ローカルビルドIDはサイドパネルからの診断にだけ返す", async () => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const message = { type: "sift:get-local-build" };
  await expect(
    listener(message, { url: "chrome-extension://test/sidepanel.html" }),
  ).resolves.toEqual({ buildId: "running-build" });
  expect(
    listener(message, { url: "https://x.com/home", tab: { id: 7 } }),
  ).toBeUndefined();
  expect(
    listener(message, {
      url: "chrome-extension://test/sidepanel.html",
      tab: { id: 7 },
    }),
  ).toBeUndefined();
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", false);
  expect(
    listener(message, { url: "chrome-extension://test/sidepanel.html" }),
  ).toBeUndefined();
});

it.each(["sidepanel.html", "/sidepanel.html"])(
  "開いた通知のパス %s で対象タブを保存し最低値を初期化する",
  (path) => {
    api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
      path,
      tabId: 7,
      windowId: 1,
    });
    expect(api.storage.session.set).toHaveBeenCalledWith({
      "sift:sidepanel-tab-id": 7,
    });
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: "sift:sidepanel-set-panel-tab",
      tabId: 7,
      resetMinimum: true,
    });
  },
);

it.each([
  { path: "/other.html", tabId: 7 },
  { path: "/nested/sidepanel.html", tabId: 7 },
  { path: "/sidepanel.html" },
])("別パネルやタブのない通知は初期化しない: %j", (panel) => {
  api.sidePanel.onOpened.addListener.mock.calls[0]?.[0](panel);
  expect(api.storage.session.set).not.toHaveBeenCalled();
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
});

it.each(["https://example.com/", "chrome://newtab/", undefined])(
  "%s でもクリック直後に開き、サイトへ処理を注入しない",
  async (url) => {
    const click = api.action.onClicked.addListener.mock.calls[0]?.[0];
    click({ id: 7, url });
    expect(api.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
    await vi.waitFor(() => expect(api.runtime.sendMessage).toHaveBeenCalled());
    expect(api.scripting.insertCSS).not.toHaveBeenCalled();
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
    expect(api.tabs.sendMessage).not.toHaveBeenCalled();
  },
);

it("対応サイトは開いてから注入する", async () => {
  api.action.onClicked.addListener.mock.calls[0]?.[0]({
    id: 7,
    url: "https://www.youtube.com/@Google/videos",
  });
  expect(api.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(api.scripting.executeScript).toHaveBeenCalled(),
  );
  expect(api.runtime.sendMessage).toHaveBeenCalled();
});

it("別サイトへ移動すると注入せずパネルを無効化する", async () => {
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](
    7,
    { url: "https://example.com/" },
    { id: 7, url: "https://example.com/" },
  );
  await vi.waitFor(() =>
    expect(api.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      enabled: false,
    }),
  );
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(api.sidePanel.open).not.toHaveBeenCalled();
});

it("アクセス権を失いURLが読めないときも読み込み完了で閉じる", async () => {
  api.tabs.get.mockResolvedValueOnce({ id: 7, active: true, url: "" });
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](7, { status: "complete" });
  await vi.waitFor(() =>
    expect(api.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      enabled: false,
    }),
  );
});

it.each(["https://x.com/home", "https://x.com/uowata94?test=1"])(
  "同じサイトの移動・再読み込みではパネルを維持する: %s",
  async (url) => {
    api.tabs.get.mockResolvedValueOnce({ id: 7, active: true, url });
    api.tabs.onUpdated.addListener.mock.calls[0]?.[0](7, {
      status: "complete",
    });
    await vi.waitFor(() => expect(api.runtime.sendMessage).toHaveBeenCalled());
    expect(api.sidePanel.setOptions).not.toHaveBeenCalled();
  },
);

it("読み込み開始だけでは閉じない", async () => {
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](7, { status: "loading" });
  await Promise.resolve();
  expect(api.sidePanel.setOptions).not.toHaveBeenCalled();
  expect(api.tabs.get).not.toHaveBeenCalled();
});

it("パネルを開いた記録がないタブには触れない", async () => {
  api.storage.session.get.mockResolvedValueOnce({});
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](8, { status: "complete" });
  await Promise.resolve();
  expect(api.tabs.get).not.toHaveBeenCalled();
});

it("別タブのパネルが選択中でも元のタブの別サイト遷移を閉じる", async () => {
  api.storage.session.get.mockResolvedValueOnce({
    "sift:sidepanel-tab-id": 8,
    "sift:sidepanel-origin:7": "https://x.com",
  });
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](7, { status: "complete" });
  await vi.waitFor(() =>
    expect(api.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      enabled: false,
    }),
  );
});

it("閉じたタブのサイト記録を削除する", () => {
  api.tabs.onRemoved.addListener.mock.calls[0]?.[0](7);
  expect(api.storage.session.remove).toHaveBeenCalledWith(
    "sift:sidepanel-origin:7",
  );
});

it("別タブのパネル閉鎖で現在の接続先を消さない", async () => {
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({ tabId: 8 });
  await Promise.resolve();
  expect(api.storage.session.remove).not.toHaveBeenCalled();
});

it("可視パネルから現在の許可済みタブへ再接続する", async () => {
  api.tabs.get.mockResolvedValueOnce({
    id: 7,
    active: true,
    url: "https://x.com/uowata94",
  });
  for (let i = 0; i < 8; i++)
    api.tabs.sendMessage.mockRejectedValueOnce(new Error("No receiver"));
  const connect = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  expect(
    await connect(
      { type: "sift:sidepanel-connect-tab", tabId: 7 },
      { url: "chrome-extension://test/sidepanel.html" },
    ),
  ).toBe(true);
  expect(api.scripting.executeScript).toHaveBeenCalledWith({
    target: { tabId: 7 },
    files: ["/sift.js"],
  });
  expect(api.sidePanel.open).not.toHaveBeenCalled();
});

it("権限による注入失敗を再接続失敗として返す", async () => {
  api.tabs.get.mockResolvedValueOnce({
    id: 7,
    active: true,
    url: "https://x.com/uowata94",
  });
  for (let i = 0; i < 8; i++)
    api.tabs.sendMessage.mockRejectedValueOnce(new Error("No receiver"));
  api.scripting.insertCSS.mockRejectedValueOnce(
    new Error("Cannot access contents"),
  );
  const connect = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  expect(
    await connect(
      { type: "sift:sidepanel-connect-tab", tabId: 7 },
      { url: "chrome-extension://test/sidepanel.html" },
    ),
  ).toBe(false);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it.each([
  { url: "https://x.com/home", tab: { id: 7 } },
  { url: "chrome-extension://test/sidepanel.html", tab: { id: 7 } },
])("ページからの再接続要求は受け付けない: %j", async (sender) => {
  const connect = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  expect(
    await connect({ type: "sift:sidepanel-connect-tab", tabId: 7 }, sender),
  ).toBeUndefined();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("バックグラウンドのタブへ接続しない", async () => {
  const connect = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  expect(
    await connect(
      { type: "sift:sidepanel-connect-tab", tabId: 7 },
      { url: "chrome-extension://test/sidepanel.html" },
    ),
  ).toBe(false);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});
