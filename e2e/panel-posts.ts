import type { Page, Target } from "puppeteer-core";
import { expect } from "vitest";
import { isOwnedPanelUrl } from "../scripts/panel-target.ts";
import type { LiveSession } from "./live.ts";
import { extensionId } from "./live.ts";

export function postKey(value: string, base = "https://x.com/"): string {
  const url = new URL(value, base);
  const status = url.pathname.match(/\/status\/(\d+)/);
  if (status) return `x:${status[1]}`;
  return `${url.hostname}${url.pathname.replace(/\/$/, "")}`;
}

export async function openFilterControls(panel: Page): Promise<void> {
  await panel.locator("details[data-filter-controls]").wait();
  const controls = await panel.$("details[data-filter-controls]");
  if (!controls) throw Error("絞り込み条件を取得できません");
  try {
    if (!(await controls.evaluate((node) => node.hasAttribute("open"))))
      await panel.locator("details[data-filter-controls] > summary").click();
    await expect
      .poll(() => controls.evaluate((node) => node.hasAttribute("open")))
      .toBe(true);
  } finally {
    await controls.dispose();
  }
}

export async function readPanelPosts(panel: Page) {
  // 追加表示は収集済みの結果だけを展開する。実サイトのスクロールや取得は行わない。
  for (let count = 0; count < 20; count += 1) {
    const more = await panel.$("button[data-show-more-posts]");
    if (!more) break;
    try {
      await more.click();
    } finally {
      await more.dispose();
    }
  }
  return panel.$$eval("a[data-post-link]", (links) =>
    links.map((link) => ({
      url: (link as HTMLAnchorElement).href,
      target: link.getAttribute("target"),
      rel: link.getAttribute("rel"),
    })),
  );
}

export async function assertPageReadOnly(page: Page): Promise<void> {
  expect(
    await page.$$eval(
      "[data-sift-filter-state], [data-sift-filter-reason]",
      (nodes) => nodes.length,
    ),
    "元ページに表示制御用の属性を追加しない",
  ).toBe(0);
}

export async function assertPostOpensInNewTab(
  session: LiveSession,
  source: Page,
  panel: Page,
): Promise<void> {
  const links = await readPanelPosts(panel);
  const first = links[0];
  if (!first) throw Error("新規タブの確認に必要なパネル投稿がありません");
  const original = source.url();
  const previousTargets = new Set(session.browser.targets());
  // 初回documentはtarget生成前に始まり得るため、予算と待機をクリック前に確保する。
  const reserved = await session.loadGuard.reserveNavigation(first.url);
  const pending = Promise.withResolvers<Page>();
  // clickの待機中に監視準備が失敗しても、後続のawaitまで未処理拒否にしない。
  void pending.promise.catch(() => {});
  let claimed = false;
  let opened: Page | undefined;
  const observe = (target: Target) => {
    if (
      claimed ||
      previousTargets.has(target) ||
      target.type() !== "page" ||
      target.url().startsWith("chrome-extension:")
    )
      return;
    claimed = true;
    pending.resolve(
      (async () => {
        const page = await target.asPage();
        if (!page) throw Error("開いた投稿タブを取得できません");
        opened = page;
        await session.loadGuard.watch(page, { reservedNavigation: reserved });
        return page;
      })(),
    );
  };
  session.browser.on("targetcreated", observe);
  const timeout = setTimeout(
    () => pending.reject(Error("投稿の新規タブが作成されませんでした")),
    10000,
  );
  try {
    await panel.locator("a[data-post-link]").click();
    opened = await pending.promise;
    const postPage = opened;
    await expect.poll(() => postPage.url() !== "about:blank").toBe(true);
    await postPage.waitForFunction(() => document.readyState !== "loading", {
      timeout: 10000,
    });
    await session.loadGuard.completeReservedNavigation(postPage);
    await session.loadGuard.assertPage(postPage);
    await expect.poll(() => postPage.url()).toBe(first.url);
    expect(source.url()).toBe(original);
    await expect
      .poll(() => panel.evaluate(() => document.visibilityState))
      .toBe("hidden");
    await expect
      .poll(
        async () => {
          for (const target of session.browser.targets()) {
            if (!URL.canParse(target.url())) continue;
            const owner = Number(
              new URL(target.url()).searchParams.get("tabId"),
            );
            if (!isOwnedPanelUrl(target.url(), extensionId, owner)) continue;
            const candidate = await target.asPage();
            if (
              candidate &&
              (await candidate.evaluate(
                () =>
                  document.visibilityState === "visible" &&
                  innerWidth > 0 &&
                  innerHeight > 0,
              ))
            )
              return false;
          }
          return true;
        },
        { message: "新規投稿タブにsiftのパネルを自動表示しない" },
      )
      .toBe(true);
    await expect
      .poll(() => source.evaluate(() => document.visibilityState))
      .toBe("hidden");
    await expect
      .poll(() => postPage.evaluate(() => document.visibilityState))
      .toBe("visible");
    await session.loadGuard.assertPage(postPage);
  } finally {
    clearTimeout(timeout);
    session.browser.off("targetcreated", observe);
    await opened?.close();
    await source.bringToFront();
  }
  await expect
    .poll(() => panel.evaluate(() => document.visibilityState))
    .toBe("visible");
  expect(
    (await readPanelPosts(panel)).some(
      (post) => postKey(post.url) === postKey(first.url),
    ),
  ).toBe(true);
}

export async function capturePanelScreenshot(
  panel: Page,
  site: "x" | "bluesky",
): Promise<void> {
  const filters = await panel.$("details[data-filter-controls]");
  if (filters) {
    try {
      if (await filters.evaluate((node) => node.hasAttribute("open")))
        await panel.locator("details[data-filter-controls] > summary").click();
      await expect
        .poll(() => filters.evaluate((node) => node.hasAttribute("open")))
        .toBe(false);
    } finally {
      await filters.dispose();
    }
  }
  await panel.evaluate(() => scrollTo(0, 0));
  await panel.screenshot({
    path: `${process.cwd()}/test-results/post-collection-panel-${site}.png`,
    fullPage: false,
  });
}
