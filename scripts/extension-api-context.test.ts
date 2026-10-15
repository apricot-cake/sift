// @vitest-environment node
import { EventEmitter } from "node:events";
import type { BrowserContext } from "puppeteer-core";
import { expect, it, vi } from "vitest";
import { createExtensionApiContext } from "./extension-api-context.ts";

const extensionOrigin = "chrome-extension://sift";
const defaultContexts = [
  { id: 1, origin: extensionOrigin, name: "", uniqueId: "renderer" },
];
function fixture(contexts = defaultContexts) {
  const events = new EventEmitter();
  const session = {
    detached: false,
    on: events.on.bind(events),
    off: events.off.bind(events),
    send: vi.fn(async (method: string): Promise<object> => {
      if (method === "Runtime.enable")
        for (const context of contexts)
          events.emit("Runtime.executionContextCreated", { context });
      return { result: { value: true } };
    }),
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
  return { browserContext, session, page, events };
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
  expect(session.send).toHaveBeenCalledOnce();
  await api.dispose();
});

it("detach失敗でも所有pageを閉じる", async () => {
  const { browserContext, session, page } = fixture();
  const api = await createExtensionApiContext(browserContext, "sift");
  session.detach.mockRejectedValueOnce(Error("detach failed"));
  await expect(api.dispose()).rejects.toThrow("detach failed");
  expect(page.close).toHaveBeenCalledOnce();
});
