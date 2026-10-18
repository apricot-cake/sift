import { runInNewContext } from "node:vm";
import type { Page } from "puppeteer-core";
import { afterEach, expect, it, vi } from "vitest";
import {
  finishLive,
  type LiveSession,
  observeAutomaticPanelClose,
  tabId,
} from "../e2e/live.ts";

afterEach(() => vi.restoreAllMocks());

function fixture(chrome: Record<string, unknown>) {
  const renderer = { chrome };
  const evaluate = vi.fn(
    async (
      fn: string | ((...args: never[]) => unknown),
      ...args: unknown[]
    ) => {
      if (typeof fn === "string") return runInNewContext(fn, renderer);
      // 実rendererと同様、Node側のクロージャを持たない関数へ値を渡す。
      const callback = runInNewContext(`(${fn.toString()})`, renderer);
      return await callback(...args);
    },
  );
  const session = {
    api: { evaluate, dispose: vi.fn() },
    browser: { close: vi.fn() },
  } as unknown as LiveSession;
  return { renderer, evaluate, session };
}

it("引用符やコード断片を含むURLをコードではなくタブ検索の値として扱う", async () => {
  const url = 'https://example.com/";globalThis.injected=true;//\\\n\u2028';
  const { session, evaluate, renderer } = fixture({
    tabs: { query: async () => [{ id: 17, url }] },
  });
  expect(await tabId(session, { url: () => url } as Page)).toBe(17);
  expect(typeof evaluate.mock.calls[0]?.[0]).toBe("function");
  expect(evaluate.mock.calls[0]?.[1]).toBe(url);
  expect(renderer).not.toHaveProperty("injected");
});

it("関数引数へ分離しても閉鎖通知のタブ照合とlistener回収を維持する", async () => {
  let listener: ((event: { tabId: number }) => void) | undefined;
  const removeListener = vi.fn();
  const { session } = fixture({
    tabs: { query: async () => [{ id: 17, url: "https://example.com" }] },
    sidePanel: {
      onClosed: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        },
        removeListener,
      },
    },
  });
  const page = {
    url: () => "https://example.com",
    evaluate: vi.fn().mockResolvedValueOnce(400).mockResolvedValue(600),
  } as unknown as Page;
  const wait = await observeAutomaticPanelClose(session, page);
  listener?.({ tabId: 99 });
  listener?.({ tabId: 17 });
  await wait();
  expect(removeListener).toHaveBeenCalledWith(listener);
  expect(session.panelObservers?.size).toBe(0);
});

it.each([{}, { settings: { text: '";globalThis.injected=true;//\u2028' } }])(
  "設定の有無と特殊文字を保って復元し、ブラウザを回収する: %j",
  async (settings) => {
    const set = vi.fn();
    const remove = vi.fn();
    const { session, renderer } = fixture({
      storage: { sync: { set, remove, get: async () => settings } },
    });
    session.settings = settings;
    await finishLive(session);
    if (Object.hasOwn(settings, "settings"))
      expect(set).toHaveBeenCalledWith(settings);
    else expect(remove).toHaveBeenCalledWith("settings");
    expect(renderer).not.toHaveProperty("injected");
    expect(session.api.dispose).toHaveBeenCalledOnce();
    expect(session.browser.close).toHaveBeenCalledOnce();
  },
);
