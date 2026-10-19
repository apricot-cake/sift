// @vitest-environment node
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import type { BrowserContext } from "puppeteer-core";
import { afterEach, expect, it, vi } from "vitest";
import { createExtensionApiContext } from "./extension-api-context.ts";

const extensionOrigin = "chrome-extension://sift";
const defaultContexts = [
  { id: 1, origin: extensionOrigin, name: "", uniqueId: "renderer" },
];
function fixture(contexts = defaultContexts) {
  const events = new EventEmitter();
  const readiness = vi.fn(
    (): { extensionId: string | null; ready: boolean } => ({
      extensionId: "sift",
      ready: true,
    }),
  );
  const session = {
    detached: false,
    on: events.on.bind(events),
    off: events.off.bind(events),
    send: vi.fn(
      async (
        method: string,
        parameters?: { expression?: string; uniqueContextId?: string },
        _options?: { timeout: number },
      ): Promise<object> => {
        if (method === "Runtime.enable")
          for (const context of contexts)
            events.emit("Runtime.executionContextCreated", { context });
        if (parameters?.expression?.includes("storage?.sync?.get"))
          return { result: { value: readiness() } };
        return { result: { value: true } };
      },
    ),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn().mockResolvedValue(session),
    isClosed: vi.fn().mockReturnValue(false),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browserContext = {
    newPage: vi.fn().mockResolvedValue(page),
  } as unknown as BrowserContext;
  return { browserContext, session, page, events, readiness };
}

it("背景の静的ページを所有し、固定contextで同じAPIを5秒上限で観測する", async () => {
  const { browserContext, page, session, events } = fixture();
  const api = await createExtensionApiContext(browserContext, "sift");
  expect(page.goto).toHaveBeenCalledWith(`${extensionOrigin}/manifest.json`, {
    waitUntil: "domcontentloaded",
    timeout: 5000,
  });
  expect(await api.evaluate("chrome.tabs.query({})")).toBe(true);
  expect(session.send).toHaveBeenLastCalledWith(
    "Runtime.evaluate",
    {
      expression: "chrome.tabs.query({})",
      awaitPromise: true,
      returnByValue: true,
      uniqueContextId: "renderer",
    },
    { timeout: 5000 },
  );
  await api.dispose();
  expect(session.detach).toHaveBeenCalledOnce();
  expect(page.close).toHaveBeenCalledOnce();
  expect(events.listenerCount("Runtime.executionContextCreated")).toBe(0);
});

it("関数評価の参照も同じcontextに固定する", async () => {
  const { browserContext, session } = fixture();
  const api = await createExtensionApiContext(browserContext, "sift");
  session.send
    .mockResolvedValueOnce({ result: { objectId: "renderer-root" } })
    .mockResolvedValueOnce({ result: { value: true } });
  expect(await api.evaluate(() => true)).toBe(true);
  expect(session.send).toHaveBeenCalledWith(
    "Runtime.evaluate",
    { expression: "globalThis", uniqueContextId: "renderer" },
    { timeout: 5000 },
  );
  await api.dispose();
});

it.each(
  [
    [],
    [
      {
        id: 1,
        origin: "chrome-extension://other",
        name: "",
        uniqueId: "wrong",
      },
    ],
    [
      { id: 1, origin: extensionOrigin, name: "", uniqueId: "renderer" },
      { id: 2, origin: extensionOrigin, name: "", uniqueId: "second" },
    ],
  ].map((contexts) => ({ contexts })),
)("一意でないcontextは失敗してpage/sessionを回収する", async ({ contexts }) => {
  const { browserContext, page, session } = fixture(contexts);
  await expect(
    createExtensionApiContext(browserContext, "sift"),
  ).rejects.toThrow("一意");
  expect(session.detach).toHaveBeenCalledOnce();
  expect(page.close).toHaveBeenCalledOnce();
});

it.each([
  "Runtime.executionContextDestroyed",
  "Runtime.executionContextsCleared",
])("%s 後は再接続せず評価に失敗する", async (event) => {
  const { browserContext, session, events } = fixture();
  const api = await createExtensionApiContext(browserContext, "sift");
  events.emit(event, { executionContextId: 1 });
  events.emit("Runtime.executionContextCreated", {
    context: { ...defaultContexts[0], uniqueId: "replacement" },
  });
  await expect(api.evaluate("chrome.tabs.query({})")).rejects.toThrow("失効");
  expect(session.send).toHaveBeenCalledTimes(2);
  await api.dispose();
});

it("detach失敗でも所有pageを閉じる", async () => {
  const { browserContext, session, page } = fixture();
  const api = await createExtensionApiContext(browserContext, "sift");
  session.detach.mockRejectedValueOnce(Error("detach failed"));
  await expect(api.dispose()).rejects.toThrow("detach failed");
  expect(page.close).toHaveBeenCalledOnce();
});

afterEach(() => {
  vi.useRealTimers();
});

it("必要APIの初期化だけを同じcontextで待ち、通常の評価は再試行しない", async () => {
  vi.useFakeTimers();
  const { browserContext, session, readiness } = fixture();
  readiness
    .mockReturnValueOnce({ extensionId: null, ready: false })
    .mockReturnValueOnce({ extensionId: "sift", ready: false });
  let returned = false;
  const pending = createExtensionApiContext(browserContext, "sift").then(
    (api) => {
      returned = true;
      return api;
    },
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(returned).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(returned).toBe(false);
  await vi.advanceTimersByTimeAsync(100);
  const api = await pending;
  expect(readiness).toHaveBeenCalledTimes(3);
  const probes = session.send.mock.calls.filter(
    ([method]) => method === "Runtime.evaluate",
  );
  expect(probes.map(([, parameters]) => parameters?.uniqueContextId)).toEqual([
    "renderer",
    "renderer",
    "renderer",
  ]);
  expect(probes.map(([, , options]) => options?.timeout)).toEqual([
    5000, 4900, 4800,
  ]);
  session.send.mockRejectedValueOnce(Error("evaluation failed"));
  const before = session.send.mock.calls.length;
  await expect(api.evaluate("sideEffect()")).rejects.toThrow(
    "evaluation failed",
  );
  expect(session.send.mock.calls.length - before).toBe(1);
  await api.dispose();
});

it("準備確認はruntimeと必要APIがそろったときだけ成功する", async () => {
  const { browserContext, session } = fixture();
  const api = await createExtensionApiContext(browserContext, "sift");
  const expression = session.send.mock.calls.find(([, parameters]) =>
    parameters?.expression?.includes("storage?.sync?.get"),
  )?.[1]?.expression;
  if (typeof expression !== "string") throw Error("準備確認の式がありません");
  const chrome = {
    runtime: { id: "sift" },
    storage: { sync: { get() {} } },
    tabs: { query() {} },
    sidePanel: { getOptions() {} },
  };
  expect(runInNewContext(expression, { chrome })).toEqual({
    extensionId: "sift",
    ready: true,
  });
  for (const missing of ["storage", "tabs", "sidePanel"])
    expect(
      runInNewContext(expression, {
        chrome: { ...chrome, [missing]: undefined },
      }).ready,
    ).toBe(false);
  expect(runInNewContext(expression, {})).toEqual({
    extensionId: null,
    ready: false,
  });
  await api.dispose();
});

it("初期化の期限を超えたらリスナーと所有page/sessionを回収する", async () => {
  vi.useFakeTimers();
  const { browserContext, page, session, events, readiness } = fixture();
  readiness.mockReturnValue({ extensionId: "sift", ready: false });
  const pending = expect(
    createExtensionApiContext(browserContext, "sift"),
  ).rejects.toThrow("初期化を5秒以内");
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(session.detach).toHaveBeenCalledOnce();
  expect(page.close).toHaveBeenCalledOnce();
  expect(events.eventNames()).toEqual([]);
});

it.each([
  "Runtime.executionContextDestroyed",
  "Runtime.executionContextsCleared",
])("初期化待機中の%sでもreplacementへ接続せず回収する", async (event) => {
  vi.useFakeTimers();
  const { browserContext, page, session, events, readiness } = fixture();
  readiness.mockReturnValue({ extensionId: "sift", ready: false });
  const pending = expect(
    createExtensionApiContext(browserContext, "sift"),
  ).rejects.toThrow("失効");
  await vi.advanceTimersByTimeAsync(0);
  events.emit(event, { executionContextId: 1 });
  events.emit("Runtime.executionContextCreated", {
    context: { ...defaultContexts[0], uniqueId: "replacement" },
  });
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(readiness).toHaveBeenCalledOnce();
  expect(session.detach).toHaveBeenCalledOnce();
  expect(page.close).toHaveBeenCalledOnce();
  expect(events.eventNames()).toEqual([]);
});

it.each(["protocol", "exception", "identity"])(
  "初期化確認の%sエラーを隠さず回収する",
  async (failure) => {
    const { browserContext, page, session, events, readiness } = fixture();
    if (failure === "identity")
      readiness.mockReturnValue({ extensionId: "other", ready: true });
    else {
      const original = session.send.getMockImplementation();
      if (!original) throw Error("CDPのfixtureがありません");
      session.send.mockImplementation(async (method, parameters) => {
        if (parameters?.expression?.includes("storage?.sync?.get")) {
          if (failure === "protocol") throw Error("protocol failed");
          return { exceptionDetails: { text: "probe failed" } };
        }
        return original(method, parameters);
      });
    }
    await expect(
      createExtensionApiContext(browserContext, "sift"),
    ).rejects.toThrow(
      failure === "protocol"
        ? "protocol failed"
        : failure === "exception"
          ? "probe failed"
          : "IDが一致",
    );
    expect(session.detach).toHaveBeenCalledOnce();
    expect(page.close).toHaveBeenCalledOnce();
    expect(events.eventNames()).toEqual([]);
  },
);

it("準備確認の応答中にcontextが失効したら成功として返さない", async () => {
  const { browserContext, page, session, events, readiness } = fixture();
  readiness.mockImplementation(() => {
    events.emit("Runtime.executionContextsCleared");
    return { extensionId: "sift", ready: true };
  });
  await expect(
    createExtensionApiContext(browserContext, "sift"),
  ).rejects.toThrow("失効");
  expect(session.detach).toHaveBeenCalledOnce();
  expect(page.close).toHaveBeenCalledOnce();
  expect(events.eventNames()).toEqual([]);
});
