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
      set: vi.fn(async (_values?: Record<string, unknown>) => undefined),
      get: vi.fn(
        async (): Promise<Record<string, unknown>> => ({
          "sift:sidepanel-tab-id": 7,
          "sift:sidepanel-origin:7": "https://x.com",
        }),
      ),
      remove: vi.fn(async (_key?: string) => undefined),
    },
  },
  sidePanel: {
    setPanelBehavior: vi.fn(async () => undefined),
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

vi.mock("../utils/local-build-reload.ts", () => ({
  startLocalBuildReload: vi.fn(),
}));

beforeEach(async () => {
  Reflect.deleteProperty(globalThis, "__SIFT_RUNNING_BUILD_ID__");
  vi.clearAllMocks();
  vi.resetModules();
  api.storage.session.get.mockResolvedValue({
    "sift:sidepanel-tab-id": 7,
    "sift:sidepanel-origin:7": "https://x.com",
  });
  api.storage.session.set.mockImplementation(async () => undefined);
  api.storage.session.remove.mockImplementation(async () => undefined);
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: false,
    url: "https://example.com/",
  });
  api.tabs.sendMessage.mockResolvedValue({
    site: "youtube",
    timelineAvailable: false,
  });
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", false);
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  api.sidePanel.setOptions.mockClear();
});

it("旧版の自動開閉と共通パネルをworker起動時に無効化する", async () => {
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
    openPanelOnActionClick: false,
  });
  // onInstalled を待たず、worker の起動でも旧設定を移行する。
  expect(api.sidePanel.setOptions).toHaveBeenCalledExactlyOnceWith({
    enabled: false,
  });
});

function trackedPage(url = "https://x.com/NASA") {
  const context = {
    site: "x",
    pageKey: url,
    timelineKey: url,
    sortOrder: "newest",
    timelineAvailable: true,
    filteringEnabled: true,
  };
  const stored: Record<string, unknown> = {
    "sift:sidepanel-origin:7": "https://x.com",
    "sift:sidepanel-page:7": { id: "opening-a", url, context: { ...context } },
  };
  api.storage.session.get.mockImplementation(async () => stored);
  api.storage.session.set.mockImplementation(
    async (values: Record<string, unknown> = {}) => {
      Object.assign(stored, values);
      return undefined;
    },
  );
  api.storage.session.remove.mockImplementation(async (key = "") => {
    delete stored[key];
    return undefined;
  });
  api.tabs.get.mockResolvedValue({ id: 7, active: true, url });
  api.tabs.sendMessage.mockImplementation(async () => context);
  const check = () =>
    api.runtime.onMessage.addListener.mock.calls[0]?.[0](
      { type: "sift:sidepanel-check-page", tabId: 7 },
      { url: "chrome-extension://test/sidepanel.html?tabId=7" },
    );
  return { context, stored, check };
}

it("元の一覧を離れると同じサイトでも閉じて絞り込みを解除する", async () => {
  const { context, check } = trackedPage();
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: true,
    url: "https://x.com/home",
  });
  context.pageKey = "https://x.com/home";
  await expect(check()).resolves.toBe(true);
  expect(api.sidePanel.setOptions).toHaveBeenCalledWith({
    tabId: 7,
    enabled: false,
  });
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, {
    type: "sift:timeline-set-filtering",
    enabled: false,
  });
});

it("ライトボックスを開いて閉じても背景一覧が同じなら維持する", async () => {
  const { context, check } = trackedPage();
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: true,
    url: "https://x.com/author/status/1/photo/1",
  });
  Object.assign(context, { timelineKey: null });
  await expect(check()).resolves.toBe(false);
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: true,
    url: "https://x.com/NASA",
  });
  await expect(check()).resolves.toBe(false);
  expect(api.sidePanel.setOptions).not.toHaveBeenCalled();
});

it("一時的な一覧キーの欠損後でも同じURLの別リストを検知する", async () => {
  const { context, check } = trackedPage("https://x.com/home");
  Object.assign(context, { timelineKey: null });
  await expect(check()).resolves.toBe(false);
  context.timelineKey = "/home:list-b";
  await expect(check()).resolves.toBe(true);
});

it("背景一覧のない画像詳細は描画猶予後に閉じる", async () => {
  const { context, check } = trackedPage();
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    const url = "https://x.com/author/status/1/photo/1";
    api.tabs.get.mockResolvedValue({ id: 7, active: true, url });
    context.pageKey = url;
    await expect(check()).resolves.toBe(false);
    now.mockReturnValue(2600);
    await expect(check()).resolves.toBe(true);
  } finally {
    now.mockRestore();
  }
});

it("ページや別タブのパネルから閉鎖判定を要求できない", () => {
  trackedPage();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  for (const sender of [
    { url: "https://x.com/home", tab: { id: 7 } },
    { url: "chrome-extension://test/sidepanel.html?tabId=8" },
    { url: "chrome-extension://test/sidepanel.html?tabId=7", tab: { id: 7 } },
  ]) {
    expect(
      listener({ type: "sift:sidepanel-check-page", tabId: 7 }, sender),
    ).toBeUndefined();
  }
  expect(api.tabs.get).not.toHaveBeenCalled();
});

it("古い遷移判定の応答で開き直したパネルを閉じない", async () => {
  const { context, stored, check } = trackedPage();
  let finish!: (value: typeof context) => void;
  api.tabs.sendMessage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = check();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  stored["sift:sidepanel-page:7"] = {
    id: "opening-b",
    url: "https://x.com/NASA",
  };
  finish({ ...context, pageKey: "https://x.com/NASA" });
  await expect(pending).resolves.toBe(false);
  expect(api.sidePanel.setOptions).not.toHaveBeenCalled();
});

it("ローカルビルドIDはサイドパネルからの診断にだけ返す", async () => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const message = { type: "sift:get-local-build" };
  await expect(
    listener(message, {
      url: "chrome-extension://test/sidepanel.html?tabId=7",
    }),
  ).resolves.toEqual({ buildId: "running-build" });
  expect(
    listener(message, { url: "https://x.com/home", tab: { id: 7 } }),
  ).toBeUndefined();
  expect(
    listener(message, {
      url: "chrome-extension://test/sidepanel.html?tabId=7",
      tab: { id: 7 },
    }),
  ).toBeUndefined();
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", false);
  expect(
    listener(message, {
      url: "chrome-extension://test/sidepanel.html?tabId=7",
    }),
  ).toBeUndefined();
});

it.each([
  "sidepanel.html",
  "/sidepanel.html",
  "sidepanel.html?tabId=7",
  "/sidepanel.html?tabId=7",
])(
  "開いた通知のパス %s で対象タブを保存し復帰時の最低値は初期化しない",
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
  expect(api.sidePanel.setOptions).toHaveBeenCalledWith({
    tabId: 7,
    path: "sidepanel.html?tabId=7",
    enabled: true,
  });
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(api.scripting.executeScript).toHaveBeenCalled(),
  );
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({
    type: "sift:sidepanel-set-panel-tab",
    tabId: 7,
    resetMinimum: true,
  });
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

it.each(["https://x.com/home", "https://x.com/NASA?test=1"])(
  "一覧記録のない旧パネルでは同じサイトへの再接続を維持する: %s",
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
    url: "https://x.com/NASA",
  });
  for (let i = 0; i < 8; i++)
    api.tabs.sendMessage.mockRejectedValueOnce(new Error("No receiver"));
  const connect = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  expect(
    await connect(
      { type: "sift:sidepanel-connect-tab", tabId: 7 },
      { url: "chrome-extension://test/sidepanel.html?tabId=7" },
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
    url: "https://x.com/NASA",
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
      { url: "chrome-extension://test/sidepanel.html?tabId=7" },
    ),
  ).toBe(false);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it.each([
  { url: "https://x.com/home", tab: { id: 7 } },
  { url: "chrome-extension://test/sidepanel.html?tabId=7", tab: { id: 7 } },
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
      { url: "chrome-extension://test/sidepanel.html?tabId=7" },
    ),
  ).toBe(false);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("ローカルworkerだけが実行中ビルドIDを公開する", async () => {
  expect(Object.hasOwn(globalThis, "__SIFT_RUNNING_BUILD_ID__")).toBe(false);
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  expect(
    Object.getOwnPropertyDescriptor(globalThis, "__SIFT_RUNNING_BUILD_ID__"),
  ).toMatchObject({ value: "running-build", writable: false });
});
