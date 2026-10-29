import type { Page } from "puppeteer-core";
import { afterEach, expect, it } from "vitest";
import { openFilterControls, readPanelPosts } from "../e2e/panel-posts.ts";

afterEach(() => document.body.replaceChildren());

function fixture(fail = false) {
  document.body.innerHTML = `<div role="tablist" data-panel-tabs>
    <button role="tab" data-panel-tab="posts" aria-selected="true" aria-controls="posts">投稿</button>
    <button role="tab" data-panel-tab="filters" aria-selected="false" aria-controls="filters">絞り込み条件</button>
    </div>
    <section id="posts" role="tabpanel"><a data-post-link href="https://x.com/NASA/status/123" target="_blank" rel="noreferrer">投稿</a><button data-show-more-posts>さらに表示</button></section>
    <section id="filters" role="tabpanel" hidden><input value="100"></section>`;
  const clicks: string[] = [];
  for (const tab of document.querySelectorAll<HTMLButtonElement>(
    '[role="tab"]',
  ))
    tab.onclick = () => {
      clicks.push(tab.dataset.panelTab ?? "");
      for (const other of document.querySelectorAll('[role="tab"]')) {
        other.setAttribute("aria-selected", String(tab === other));
        const pane = document.getElementById(
          other.getAttribute("aria-controls") ?? "",
        );
        if (pane) pane.hidden = tab !== other;
      }
    };
  const more = document.querySelector<HTMLButtonElement>(
    "[data-show-more-posts]",
  );
  if (more)
    more.onclick = () => {
      expect(document.getElementById("posts")?.hidden).toBe(false);
      more.remove();
    };
  const node = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw Error(selector);
    return element;
  };
  const page = {
    locator: (selector: string) => ({
      wait: async () => {
        node(selector);
      },
      click: async () => node(selector).click(),
    }),
    $eval: async (selector: string, callback: (element: Element) => unknown) =>
      callback(node(selector)),
    $$eval: async (
      selector: string,
      callback: (elements: Element[]) => unknown,
    ) => {
      if (fail) throw Error("読取失敗");
      return callback([...document.querySelectorAll(selector)]);
    },
    $: async (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      return element
        ? { click: async () => element.click(), dispose: async () => {} }
        : null;
    },
  } as unknown as Page;
  return { page, clicks };
}

it("投稿を読む間だけ投稿タブを実クリックし、条件タブと入力値を復元する", async () => {
  const { page, clicks } = fixture();
  await openFilterControls(page);
  const input = document.querySelector("input");
  const posts = await readPanelPosts(page);
  expect(posts).toEqual([
    {
      url: "https://x.com/NASA/status/123",
      target: "_blank",
      rel: "noreferrer",
    },
  ]);
  expect(clicks).toEqual(["filters", "posts", "filters"]);
  expect(document.querySelector("input")).toBe(input);
  expect(input?.value).toBe("100");
  expect(document.getElementById("filters")?.hidden).toBe(false);
});

it("読取失敗でも呼出時の条件タブを復元する", async () => {
  const { page, clicks } = fixture(true);
  await openFilterControls(page);
  await expect(readPanelPosts(page)).rejects.toThrow("読取失敗");
  expect(clicks).toEqual(["filters", "posts", "filters"]);
  expect(document.getElementById("filters")?.hidden).toBe(false);
});

it("投稿タブから読む場合は不要なタブ切替をしない", async () => {
  const { page, clicks } = fixture();
  expect(await readPanelPosts(page)).toHaveLength(1);
  expect(clicks).toEqual([]);
  expect(document.getElementById("posts")?.hidden).toBe(false);
});
