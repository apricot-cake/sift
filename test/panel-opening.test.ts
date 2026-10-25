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
      get: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
      remove: vi.fn(async (_key?: string | string[]) => undefined),
    },
  },
  sidePanel: {
    setPanelBehavior: vi.fn(async () => undefined),
    setOptions: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    onOpened: { addListener: vi.fn() },
    onClosed: { addListener: vi.fn() },
  },
  tabs: {
    onCreated: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
    sendMessage: vi.fn(async () => ({
      site: "x",
      timelineAvailable: false,
    })),
    query: vi.fn(async (): Promise<{ id?: number }[]> => []),
    get: vi.fn(async () => ({
      id: 7,
      active: false,
      url: "https://example.com/",
    })),
  },
  scripting: {
    insertCSS: vi.fn(async () => undefined),
    executeScript: vi.fn(
      async (_injection?: { target: { tabId: number }; files: string[] }) =>
        undefined,
    ),
  },
}));
const checkLocalBuild = vi.hoisted(() =>
  vi.fn(async (_ownBuild: string): Promise<boolean> => true),
);
vi.mock("wxt/browser", () => ({ browser: api }));
vi.mock("../utils/filter-context.ts", () => ({
  FILTER_CONTEXT_REQUEST: "sift:get-filter-context",
  isFilterContextResponse: () => true,
}));

vi.mock("../utils/local-build-reload.ts", () => ({
  CHECK_LOCAL_BUILD: "sift:check-local-build",
  checkLocalBuild,
}));

beforeEach(async () => {
  Reflect.deleteProperty(globalThis, "__SIFT_RUNNING_BUILD_ID__");
  vi.resetAllMocks();
  vi.resetModules();
  checkLocalBuild.mockResolvedValue(true);
  api.runtime.sendMessage.mockResolvedValue(undefined);
  api.sidePanel.setOptions.mockResolvedValue(undefined);
  api.sidePanel.open.mockResolvedValue(undefined);
  api.sidePanel.close.mockResolvedValue(undefined);
  api.tabs.query.mockResolvedValue([]);
  api.scripting.insertCSS.mockResolvedValue(undefined);
  api.scripting.executeScript.mockResolvedValue(undefined);
  api.storage.session.get.mockResolvedValue({});
  api.storage.session.set.mockImplementation(async () => undefined);
  api.storage.session.remove.mockImplementation(async () => undefined);
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: false,
    url: "https://example.com/",
  });
  api.tabs.sendMessage.mockResolvedValue({
    site: "x",
    timelineAvailable: false,
  });
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", false);
  vi.stubGlobal("__SIFT_LOCAL_BUILD__", false);
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  await new Promise((resolve) => setTimeout(resolve, 0));
  api.sidePanel.setOptions.mockClear();
  api.storage.session.remove.mockClear();
});

it("自動起動設定と共通パネルをworker起動時に無効化する", async () => {
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  expect(api.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
    openPanelOnActionClick: false,
  });
  // onInstalled を待たず、worker の起動でも旧設定を移行する。
  expect(api.sidePanel.setOptions).toHaveBeenCalledExactlyOnceWith({
    enabled: false,
  });
  expect(api.action.onClicked.addListener).toHaveBeenCalled();
  expect(api.sidePanel.open).not.toHaveBeenCalled();
});

it("権限を得るアクションの同期区間で開き、接続は開いた通知まで待つ", async () => {
  const configured = Promise.withResolvers<undefined>();
  const viewport = Promise.withResolvers<undefined>();
  api.sidePanel.setOptions.mockReturnValueOnce(configured.promise);
  api.scripting.executeScript.mockReturnValueOnce(viewport.promise);
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: true,
    url: "https://x.com/NASA",
  });
  api.action.onClicked.addListener.mock.calls[0]?.[0]({
    id: 7,
    url: "https://x.com/NASA",
  });
  expect(api.sidePanel.open).toHaveBeenCalledExactlyOnceWith({ tabId: 7 });
  expect(scriptRequests("/panel-viewport.js")).toEqual([
    { target: { tabId: 7 }, files: ["/panel-viewport.js"] },
  ]);
  expect(
    api.scripting.executeScript.mock.invocationCallOrder[0] ?? Infinity,
  ).toBeLessThan(api.sidePanel.open.mock.invocationCallOrder[0] ?? 0);
  expect(scriptRequests("/sift.js")).toHaveLength(0);
  expect(api.storage.session.set).not.toHaveBeenCalled();
  configured.resolve(undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scriptRequests("/sift.js")).toHaveLength(0);
  viewport.resolve(undefined);
  api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
    path: "/sidepanel.html",
    tabId: 7,
    windowId: 1,
  });
  await vi.waitFor(() =>
    expect(scriptRequests("/sift.js")).toEqual([
      { target: { tabId: 7 }, files: ["/sift.js"] },
    ]),
  );
});

it.each(["https://example.com/", "chrome://newtab/", undefined])(
  "対象外URL %s のアクションではviewport準備も注入しない",
  async (url) => {
    api.action.onClicked.addListener.mock.calls[0]?.[0]({
      id: 7,
      windowId: 1,
      url,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.sidePanel.open).toHaveBeenCalledExactlyOnceWith({ tabId: 7 });
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  },
);

it("タブIDのないアクションではパネルを開かない", () => {
  api.action.onClicked.addListener.mock.calls[0]?.[0]({
    url: "https://x.com/NASA",
  });
  expect(api.sidePanel.open).not.toHaveBeenCalled();
  expect(api.sidePanel.setOptions).not.toHaveBeenCalled();
});

it("worker起動時に既存タブを準備し、権限取得や自動起動はしない", async () => {
  api.tabs.query.mockResolvedValue([{ id: 7 }, { id: 8 }, {}]);
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  await vi.waitFor(() =>
    expect(api.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 8,
      path: "sidepanel.html?tabId=8",
      enabled: true,
    }),
  );
  expect(api.sidePanel.setOptions).toHaveBeenCalledWith({
    tabId: 7,
    path: "sidepanel.html?tabId=7",
    enabled: true,
  });
  expect(api.sidePanel.open).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("新規タブにも固有パネルを準備し、IDのない通知は無視する", () => {
  const created = api.tabs.onCreated.addListener.mock.calls[0]?.[0];
  created({ id: 8 });
  created({});
  expect(api.sidePanel.setOptions).toHaveBeenCalledExactlyOnceWith({
    tabId: 8,
    path: "sidepanel.html?tabId=8",
    enabled: true,
  });
  expect(api.sidePanel.open).not.toHaveBeenCalled();
});

it("移行時には旧所有キーだけを削除しタブ別のページ記録を保つ", async () => {
  const { stored } = trackedPage();
  stored["sift:sidepanel-tab-id"] = 7;
  stored["sift:sidepanel-origin:7"] = "https://x.com";
  stored["sift:sidepanel-origin:8"] = "https://bsky.app";
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  await vi.waitFor(() =>
    expect(api.storage.session.remove).toHaveBeenCalledWith([
      "sift:sidepanel-tab-id",
      "sift:sidepanel-origin:7",
      "sift:sidepanel-origin:8",
    ]),
  );
  expect(stored["sift:sidepanel-page:7"]).toBeDefined();
  expect(stored["sift:sidepanel-tab-id"]).toBeUndefined();
});

function openTab(tab: { id: number; url?: string }): void {
  api.tabs.get.mockResolvedValue({
    id: tab.id,
    active: true,
    url: tab.url ?? "",
  });
  api.tabs.onCreated.addListener.mock.calls[0]?.[0](tab);
  api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
    path: "/sidepanel.html",
    tabId: tab.id,
    windowId: 1,
  });
}

function scriptRequests(file: string) {
  return api.scripting.executeScript.mock.calls
    .map(([request]) => request)
    .filter((request) => request?.files.includes(file));
}

function trackedPage(url = "https://x.com/NASA") {
  const context = {
    site: "x",
    pageKey: url,
    timelineKey: url,
    timelineAvailable: true,
    filteringEnabled: true,
  };
  const stored: Record<string, unknown> = {
    "sift:sidepanel-page:7": {
      id: "opening-a",
      url,
      windowId: 1,
      context: { ...context },
    },
  };
  api.storage.session.get.mockImplementation(async () => stored);
  api.storage.session.set.mockImplementation(
    async (values: Record<string, unknown> = {}) => {
      Object.assign(stored, values);
      return undefined;
    },
  );
  api.storage.session.remove.mockImplementation(async (keys = []) => {
    for (const key of typeof keys === "string" ? [keys] : keys)
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

it("開いているパネルで開いた通知が再発しなくてもアクションで再接続する", async () => {
  const { stored } = trackedPage();
  openTab({ id: 7, url: "https://x.com/NASA" });
  await vi.waitFor(() =>
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: "sift:sidepanel-set-panel-tab",
      tabId: 7,
    }),
  );
  api.scripting.executeScript.mockClear();
  api.runtime.sendMessage.mockClear();
  api.action.onClicked.addListener.mock.calls[0]?.[0]({
    id: 7,
    windowId: 1,
    url: "https://x.com/NASA",
  });
  await vi.waitFor(() =>
    expect(scriptRequests("/sift.js")).toEqual([
      { target: { tabId: 7 }, files: ["/sift.js"] },
    ]),
  );
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({
    type: "sift:sidepanel-set-panel-tab",
    tabId: 7,
    resetMinimum: false,
  });
  expect(api.runtime.sendMessage).not.toHaveBeenCalledWith({
    type: "sift:sidepanel-set-panel-tab",
    tabId: 7,
    resetMinimum: true,
  });
  expect(stored["sift:sidepanel-page:7"]).toMatchObject({
    url: "https://x.com/NASA",
    context: { timelineKey: "https://x.com/NASA" },
  });
});

it("アクション中に開いた通知が先行したら二重に接続しない", async () => {
  trackedPage();
  api.sidePanel.open.mockImplementationOnce(async () => {
    api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
      path: "/sidepanel.html",
      tabId: 7,
      windowId: 1,
    });
  });
  api.action.onClicked.addListener.mock.calls[0]?.[0]({
    id: 7,
    windowId: 1,
    url: "https://x.com/NASA",
  });
  await vi.waitFor(() =>
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: "sift:sidepanel-set-panel-tab",
      tabId: 7,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scriptRequests("/sift.js")).toEqual([
    { target: { tabId: 7 }, files: ["/sift.js"] },
  ]);
});

it("アクションの保存記録照会中に閉じて開き直したら古い照会を捨てる", async () => {
  const { stored } = trackedPage();
  openTab({ id: 7, url: "https://x.com/NASA" });
  await vi.waitFor(() =>
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: "sift:sidepanel-set-panel-tab",
      tabId: 7,
    }),
  );
  api.storage.session.get.mockClear();
  const oldRecord = { ...stored };
  const pending = Promise.withResolvers<Record<string, unknown>>();
  api.storage.session.get.mockReturnValueOnce(pending.promise);
  api.action.onClicked.addListener.mock.calls[0]?.[0]({
    id: 7,
    windowId: 1,
    url: "https://x.com/NASA",
  });
  await vi.waitFor(() => expect(api.storage.session.get).toHaveBeenCalled());
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({
    tabId: 7,
    windowId: 1,
  });
  api.runtime.sendMessage.mockClear();
  openTab({ id: 7, url: "https://x.com/NASA" });
  await vi.waitFor(() =>
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: "sift:sidepanel-set-panel-tab",
      tabId: 7,
    }),
  );
  const reopened = stored["sift:sidepanel-page:7"];
  api.scripting.executeScript.mockClear();
  api.runtime.sendMessage.mockClear();
  pending.resolve(oldRecord);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
  expect(stored["sift:sidepanel-page:7"]).toBe(reopened);
});

it("worker再起動でメモリが空でも保存した所有記録からアクションで復旧する", async () => {
  const { stored } = trackedPage();
  api.action.onClicked.addListener.mock.calls[0]?.[0]({
    id: 7,
    windowId: 1,
    url: "https://x.com/NASA",
  });
  await vi.waitFor(() =>
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: "sift:sidepanel-set-panel-tab",
      tabId: 7,
    }),
  );
  expect(scriptRequests("/sift.js")).toEqual([
    { target: { tabId: 7 }, files: ["/sift.js"] },
  ]);
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({
    type: "sift:sidepanel-set-panel-tab",
    tabId: 7,
    resetMinimum: false,
  });
  expect(stored["sift:sidepanel-page:7"]).toMatchObject({
    windowId: 1,
    url: "https://x.com/NASA",
  });
});

it("初回のアクションでは所有記録を捏造せず開いた通知へ接続を任せる", async () => {
  api.action.onClicked.addListener.mock.calls[0]?.[0]({
    id: 7,
    windowId: 1,
    url: "https://x.com/NASA",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.sidePanel.open).toHaveBeenCalledExactlyOnceWith({ tabId: 7 });
  expect(api.storage.session.set).not.toHaveBeenCalled();
  expect(scriptRequests("/sift.js")).toHaveLength(0);
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
});

it("元の一覧を離れると同じサイトでも閉じて絞り込みを解除する", async () => {
  const { context, check } = trackedPage();
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: true,
    url: "https://x.com/home",
  });
  context.pageKey = "https://x.com/home";
  await expect(check()).resolves.toBe(true);
  expect(api.sidePanel.close).toHaveBeenCalledWith({ tabId: 7 });
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({
    tabId: 7,
    windowId: 1,
  });
  await vi.waitFor(() =>
    expect(api.storage.session.remove).toHaveBeenCalledWith(
      "sift:sidepanel-page:7",
    ),
  );
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
  expect(api.sidePanel.close).not.toHaveBeenCalled();
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
  expect(api.sidePanel.close).not.toHaveBeenCalled();
});

it("ローカルビルドIDはサイドパネルからの診断にだけ返す", async () => {
  vi.stubGlobal("__SIFT_LOCAL_BUILD__", true);
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
  vi.stubGlobal("__SIFT_LOCAL_BUILD__", false);
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
  async (path) => {
    trackedPage();
    api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
      path,
      tabId: 7,
      windowId: 1,
    });
    await vi.waitFor(() =>
      expect(api.runtime.sendMessage).toHaveBeenCalledWith({
        type: "sift:sidepanel-set-panel-tab",
        tabId: 7,
        resetMinimum: false,
      }),
    );
    expect(api.storage.session.set).toHaveBeenCalledWith({
      "sift:sidepanel-page:7": expect.objectContaining({
        url: "https://x.com/NASA",
        windowId: 1,
      }),
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
    openTab({ id: 7, url });
    expect(api.sidePanel.open).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(api.runtime.sendMessage).toHaveBeenCalled());
    expect(api.scripting.insertCSS).not.toHaveBeenCalled();
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
    expect(api.tabs.sendMessage).not.toHaveBeenCalled();
  },
);

it("対応サイトは開いてから注入する", async () => {
  openTab({
    id: 7,
    url: "https://x.com/Google",
  });
  expect(api.sidePanel.open).not.toHaveBeenCalled();
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
    resetMinimum: false,
  });
});

it("注入直後に受信側が準備できていなければ短く待って接続する", async () => {
  api.tabs.sendMessage.mockRejectedValueOnce(new Error("No receiver"));
  api.tabs.sendMessage.mockRejectedValueOnce(new Error("No receiver"));
  openTab({ id: 7, url: "https://x.com/NASA" });
  await vi.waitFor(() => expect(api.tabs.sendMessage).toHaveBeenCalledTimes(3));
  expect(api.scripting.executeScript).toHaveBeenCalledOnce();
});

it("記録がないタブは閉鎖判定でも照会しない", async () => {
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  await expect(
    listener(
      { type: "sift:sidepanel-check-page", tabId: 7 },
      { url: "chrome-extension://test/sidepanel.html?tabId=7" },
    ),
  ).resolves.toBeNull();
  expect(api.tabs.get).not.toHaveBeenCalled();
  expect(api.sidePanel.close).not.toHaveBeenCalled();
});

it("タブIDのない閉鎖通知では他のパネルを停止しない", async () => {
  trackedPage();
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({ windowId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.storage.session.remove).not.toHaveBeenCalled();
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
});

it("別ウィンドウの閉鎖通知で接続中のパネルをキャンセルしない", async () => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  const pending = Promise.withResolvers<boolean>();
  checkLocalBuild.mockReturnValueOnce(pending.promise);
  openTab({ id: 7, url: "https://x.com/NASA" });
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({
    tabId: 7,
    windowId: 2,
  });
  pending.resolve(true);
  await vi.waitFor(() =>
    expect(api.scripting.executeScript).toHaveBeenCalled(),
  );
  expect(api.storage.session.remove).not.toHaveBeenCalled();
});

it("閉じた記録の削除完了を待ってから新しい所有記録を保存する", async () => {
  const { stored } = trackedPage();
  const pending = Promise.withResolvers<void>();
  api.storage.session.remove.mockImplementationOnce(async () => {
    await pending.promise;
    delete stored["sift:sidepanel-page:7"];
  });
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({
    tabId: 7,
    windowId: 1,
  });
  await vi.waitFor(() => expect(api.storage.session.remove).toHaveBeenCalled());
  openTab({ id: 7, url: "https://x.com/home" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.storage.session.set).not.toHaveBeenCalled();
  pending.resolve();
  await vi.waitFor(() =>
    expect(stored["sift:sidepanel-page:7"]).toMatchObject({
      url: "https://x.com/home",
    }),
  );
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({
    type: "sift:sidepanel-set-panel-tab",
    tabId: 7,
    resetMinimum: true,
  });
  expect(api.tabs.sendMessage).not.toHaveBeenCalledWith(7, {
    type: "sift:timeline-set-filtering",
    enabled: false,
  });
  expect(
    api.runtime.sendMessage.mock.invocationCallOrder[0] ?? Infinity,
  ).toBeLessThan(api.scripting.insertCSS.mock.invocationCallOrder[0] ?? 0);
});

it("別サイトへ移動すると注入せずパネルを閉じる", async () => {
  trackedPage();
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: true,
    url: "https://example.com/",
  });
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](
    7,
    { url: "https://example.com/" },
    { id: 7, url: "https://example.com/" },
  );
  await vi.waitFor(() =>
    expect(api.sidePanel.close).toHaveBeenCalledWith({ tabId: 7 }),
  );
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(api.sidePanel.open).not.toHaveBeenCalled();
});

it("アクセス権を失いURLが読めないときも読み込み完了で閉じる", async () => {
  trackedPage();
  api.tabs.get.mockResolvedValue({ id: 7, active: true, url: "" });
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](7, { status: "complete" });
  await vi.waitFor(() =>
    expect(api.sidePanel.close).toHaveBeenCalledWith({ tabId: 7 }),
  );
});

it("読み込み開始だけでは閉じない", async () => {
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](7, { status: "loading" });
  await Promise.resolve();
  expect(api.sidePanel.close).not.toHaveBeenCalled();
  expect(api.tabs.get).not.toHaveBeenCalled();
});

it("パネルを開いた記録がないタブには触れない", async () => {
  api.storage.session.get.mockResolvedValueOnce({});
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](8, { status: "complete" });
  await Promise.resolve();
  expect(api.tabs.get).not.toHaveBeenCalled();
});

it("別タブのパネルが選択中でも元のタブの別サイト遷移を閉じる", async () => {
  const { stored } = trackedPage();
  stored["sift:sidepanel-page:8"] = {
    id: "other",
    url: "https://bsky.app/",
    windowId: 2,
  };
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: false,
    url: "https://example.com/",
  });
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](7, { status: "complete" });
  await vi.waitFor(() =>
    expect(api.sidePanel.close).toHaveBeenCalledWith({ tabId: 7 }),
  );
});

it("閉じたタブのサイト記録を削除する", () => {
  api.tabs.onRemoved.addListener.mock.calls[0]?.[0](7);
  expect(api.storage.session.remove).toHaveBeenCalledWith(
    "sift:sidepanel-page:7",
  );
});

it("別タブのパネル閉鎖で現在の接続先を消さない", async () => {
  const { stored } = trackedPage();
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({ tabId: 8 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.storage.session.remove).not.toHaveBeenCalledWith(
    "sift:sidepanel-page:7",
  );
  expect(stored["sift:sidepanel-page:7"]).toBeDefined();
});

it("可視パネルから現在の許可済みタブへ再接続する", async () => {
  trackedPage();
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
  trackedPage();
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
  vi.stubGlobal("__SIFT_LOCAL_BUILD__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  expect(
    Object.getOwnPropertyDescriptor(globalThis, "__SIFT_RUNNING_BUILD_ID__"),
  ).toMatchObject({ value: "running-build", writable: false });
});

it("検証候補はビルドIDを返し、初回起動とパネル通知でも日常版の更新を確認しない", async () => {
  vi.stubGlobal("__SIFT_LOCAL_BUILD__", true);
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", false);
  vi.stubGlobal("__SIFT_BUILD_ID__", "candidate-build");
  checkLocalBuild.mockResolvedValue(false);
  api.tabs.get.mockResolvedValue({
    id: 7,
    active: true,
    url: "https://x.com/NASA",
  });
  api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
    path: "/sidepanel.html",
    tabId: 7,
    windowId: 1,
  });
  await vi.waitFor(() =>
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["/sift.js"],
    }),
  );
  expect(checkLocalBuild).not.toHaveBeenCalled();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  await expect(
    listener(
      { type: "sift:get-local-build" },
      { url: "chrome-extension://test/sidepanel.html?tabId=7" },
    ),
  ).resolves.toEqual({ buildId: "candidate-build" });
});

it("ローカルworkerの起動だけではNative Hostへ問い合わせない", async () => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const background = await import("../entrypoints/background.ts");
  background.default.main();
  expect(checkLocalBuild).not.toHaveBeenCalled();
});

it("更新確認を待つ間もユーザー操作内でパネルを開き、注入は確認後に行う", async () => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const pending = Promise.withResolvers<boolean>();
  checkLocalBuild.mockReturnValueOnce(pending.promise);
  openTab({
    id: 7,
    url: "https://x.com/NASA",
  });
  expect(api.sidePanel.open).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(checkLocalBuild).toHaveBeenCalledWith("running-build"),
  );
  expect(api.scripting.insertCSS).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
  pending.resolve(true);
  await vi.waitFor(() =>
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["/sift.js"],
    }),
  );
});

it("パネル起動時に更新を検知したら旧ビルドの注入と初期化通知を行わない", async () => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  checkLocalBuild.mockResolvedValue(false);
  openTab({
    id: 7,
    url: "https://x.com/NASA",
  });
  await vi.waitFor(() => expect(checkLocalBuild).toHaveBeenCalled());
  // アクションの非同期処理が更新判定から復帰した後も処理を続けない。
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.scripting.insertCSS).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
});

it.each([{ tabId: 7, windowId: 1 }])(
  "開いた通知の更新確認中に閉じたパネルの接続先を復活させない: %j",
  async (closedPanel) => {
    vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
    vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
    const pending = Promise.withResolvers<boolean>();
    checkLocalBuild.mockReturnValueOnce(pending.promise);
    api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
      path: "/sidepanel.html?tabId=7",
      tabId: 7,
      windowId: 1,
    });
    expect(checkLocalBuild).toHaveBeenCalledOnce();
    api.sidePanel.onClosed.addListener.mock.calls[0]?.[0](closedPanel);
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.storage.session.set.mockClear();
    api.runtime.sendMessage.mockClear();
    pending.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.storage.session.set).not.toHaveBeenCalled();
    expect(api.runtime.sendMessage).not.toHaveBeenCalled();
    expect(checkLocalBuild).toHaveBeenCalledOnce();
  },
);

it("開いた通知の更新確認中にタブが閉じた場合も通知を破棄する", async () => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const pending = Promise.withResolvers<boolean>();
  checkLocalBuild.mockReturnValueOnce(pending.promise);
  api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
    path: "/sidepanel.html?tabId=7",
    tabId: 7,
    windowId: 1,
  });
  api.tabs.onRemoved.addListener.mock.calls[0]?.[0](7);
  pending.resolve(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.storage.session.set).not.toHaveBeenCalled();
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
});

it.each([{ tabId: 7, windowId: 1 }])(
  "アクションの更新確認中に閉じたら注入と初期化通知を再開しない: %j",
  async (closedPanel) => {
    vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
    vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
    const pending = Promise.withResolvers<boolean>();
    checkLocalBuild.mockReturnValueOnce(pending.promise);
    openTab({
      id: 7,
      url: "https://x.com/NASA",
    });
    await vi.waitFor(() => expect(checkLocalBuild).toHaveBeenCalled());
    api.sidePanel.onClosed.addListener.mock.calls[0]?.[0](closedPanel);
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending.resolve(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.scripting.insertCSS).not.toHaveBeenCalled();
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
    expect(api.runtime.sendMessage).not.toHaveBeenCalled();
  },
);

it("開き直したパネルを、先に閉じた通知の遅れた処理で切断しない", async () => {
  const pending = Promise.withResolvers<Record<string, unknown>>();
  api.storage.session.get.mockReturnValueOnce(pending.promise);
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({ tabId: 7 });
  api.sidePanel.onOpened.addListener.mock.calls[0]?.[0]({
    path: "/sidepanel.html?tabId=7",
    tabId: 7,
    windowId: 1,
  });
  pending.resolve({ "sift:sidepanel-page:7": { id: "old" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.storage.session.remove).not.toHaveBeenCalledWith(
    "sift:sidepanel-page:7",
  );
});

it("パネルの操作時確認は更新判定の結果を返す", async () => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const sender = { url: "chrome-extension://test/sidepanel.html?tabId=7" };
  checkLocalBuild.mockResolvedValueOnce(false);
  await expect(
    listener({ type: "sift:check-local-build" }, sender),
  ).resolves.toBe(false);
  expect(checkLocalBuild).toHaveBeenCalledWith("running-build");
  await expect(
    listener({ type: "sift:check-local-build" }, sender),
  ).resolves.toBe(true);
});

it.each([
  { url: "https://x.com/home", tab: { id: 7 } },
  { url: "chrome-extension://test/sidepanel.html?tabId=7", tab: { id: 7 } },
  { url: "chrome-extension://test/sidepanel.html" },
  { url: "chrome-extension://test/other.html?tabId=7" },
  { url: "chrome-extension://foreign/sidepanel.html?tabId=7" },
])("パネル以外から更新確認を起動できない: %j", (sender) => {
  vi.stubGlobal("__SIFT_LOCAL_DEPLOY__", true);
  vi.stubGlobal("__SIFT_BUILD_ID__", "running-build");
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  expect(listener({ type: "sift:check-local-build" }, sender)).toBeUndefined();
  expect(checkLocalBuild).not.toHaveBeenCalled();
});

it("ストア版ではパネル操作を許可してNative Hostへ問い合わせない", async () => {
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  await expect(
    listener(
      { type: "sift:check-local-build" },
      { url: "chrome-extension://test/sidepanel.html?tabId=7" },
    ),
  ).resolves.toBe(true);
  openTab({
    id: 7,
    url: "https://x.com/NASA",
  });
  await vi.waitFor(() =>
    expect(api.scripting.executeScript).toHaveBeenCalled(),
  );
  expect(checkLocalBuild).not.toHaveBeenCalled();
});

it("遅れた別サイト遷移の判定で、再接続して開いたパネルを閉じない", async () => {
  const { stored } = trackedPage();
  api.storage.session.get.mockImplementation(async () => ({ ...stored }));
  const nextTab = {
    id: 7,
    active: true,
    url: "https://bsky.app/profile/bsky.app",
  };
  const pending = Promise.withResolvers<typeof nextTab>();
  api.tabs.get
    .mockResolvedValue(nextTab)
    .mockImplementationOnce(() => pending.promise);
  api.tabs.onUpdated.addListener.mock.calls[0]?.[0](7, { status: "complete" });
  await vi.waitFor(() => expect(api.tabs.get).toHaveBeenCalledOnce());
  api.sidePanel.onClosed.addListener.mock.calls[0]?.[0]({
    tabId: 7,
    windowId: 1,
  });
  openTab(nextTab);
  await vi.waitFor(() =>
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: "sift:sidepanel-set-panel-tab",
      tabId: 7,
      resetMinimum: true,
    }),
  );
  pending.resolve(nextTab);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.sidePanel.setOptions).toHaveBeenCalledWith({
    tabId: 7,
    path: "sidepanel.html?tabId=7",
    enabled: true,
  });
  expect(api.sidePanel.setOptions).not.toHaveBeenCalledWith({
    tabId: 7,
    enabled: false,
  });
  expect(stored["sift:sidepanel-page:7"]).toMatchObject({ url: nextTab.url });
});
