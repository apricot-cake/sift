import type { Page } from "puppeteer-core";
import { afterEach, expect, it } from "vitest";
import { observations } from "../e2e/compatibility.cases.ts";

afterEach(() => {
  document.body.replaceChildren();
});

const timestamp =
  '<a href="/NASA/status/123"><time datetime="2026-10-25"></time></a>';
const card = (body: string) => `<article data-testid="tweet">${body}</article>`;
const ad = (body: string) =>
  `<div data-testid="placementTracking">${card(body)}</div>`;

it.each([
  ["投稿リンクのない広告", ad(""), 0, null],
  [
    "時刻でない投稿リンクだけの広告",
    ad('<a href="/NASA/status/123">リンク</a>'),
    0,
    null,
  ],
  [
    "時刻URLが壊れた広告",
    ad('<a href="https://[bad"><time datetime="2026-10-25"></time></a>'),
    0,
    null,
  ],
  ["時刻リンクのある広告", ad(timestamp), 1, "/NASA/status/123"],
  [
    "子孫だけに広告マーカーがある通常動画",
    card(
      `${timestamp}<div data-testid="placementTracking"><video></video></div>`,
    ),
    1,
    "/NASA/status/123",
  ],
  ["リンクの壊れた通常投稿", card("本文"), 1, null],
  [
    "子孫だけにマーカーがあるリンク破損投稿",
    card('<div data-testid="placementTracking"></div>'),
    1,
    null,
  ],
  [
    "引用だけに時刻リンクがある広告",
    ad(
      `<div role="link"><div data-testid="Tweet-User-Avatar"></div>${timestamp}</div>`,
    ),
    0,
    null,
  ],
] as const)("独立観測: %s", async (_name, markup, count, id) => {
  document.body.innerHTML = markup;
  for (const article of document.querySelectorAll("article"))
    Object.assign(article, { checkVisibility: () => true });
  const page = {
    $$eval: async (
      selector: string,
      callback: (nodes: Element[], metric: string) => unknown,
      metric: string,
    ) => callback([...document.querySelectorAll(selector)], metric),
  } as unknown as Page;
  const rows = await observations(page, {
    id: "x-following",
    site: "x",
    start: "https://x.com/home",
    destination: "/home",
  });
  expect(rows).toHaveLength(count);
  if (count) expect(rows[0]?.id).toBe(id);
});
