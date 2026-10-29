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

export async function selectPanelTab(panel: Page, tab: "posts" | "filters") {
  const selector = `[data-panel-tabs] [role="tab"][data-panel-tab="${tab}"]`;
  await panel.locator(selector).wait();
  if (
    (await panel.$eval(selector, (node) =>
      node.getAttribute("aria-selected"),
    )) !== "true"
  )
    await panel.locator(selector).click();
  await expect
    .poll(() =>
      panel.$eval(selector, (node) => {
        const pane = document.getElementById(
          node.getAttribute("aria-controls") ?? "",
        );
        return (
          node.getAttribute("aria-selected") === "true" &&
          pane?.getAttribute("role") === "tabpanel" &&
          !pane.hidden
        );
      }),
    )
    .toBe(true);
}

export async function openFilterControls(panel: Page): Promise<void> {
  await selectPanelTab(panel, "filters");
}

export async function readPanelPosts(panel: Page) {
  const previous = await panel.$eval(
    '[data-panel-tabs] [role="tab"][aria-selected="true"]',
    (node) => node.getAttribute("data-panel-tab"),
  );
  await selectPanelTab(panel, "posts");
  try {
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
    return await panel.$$eval("a[data-post-link]", (links) =>
      links.map((link) => ({
        url: (link as HTMLAnchorElement).href,
        target: link.getAttribute("target"),
        rel: link.getAttribute("rel"),
      })),
    );
  } finally {
    if (previous === "filters") await selectPanelTab(panel, "filters");
  }
}

export async function assertPanelTabsPreserveState(panel: Page): Promise<void> {
  await openFilterControls(panel);
  const settings = () =>
    panel.$$eval(
      '[data-filter-controls] [role="combobox"], [data-filter-controls] [role="switch"], [data-filter-controls] input',
      (nodes) =>
        nodes.map((node) => {
          const copy = node.cloneNode(true) as Element;
          copy.querySelectorAll("[data-choice-count]").forEach((count) => {
            count.remove();
          });
          return {
            label: node.getAttribute("aria-label"),
            checked: node.getAttribute("aria-checked"),
            value:
              node instanceof HTMLInputElement
                ? node.value
                : copy.textContent?.trim(),
          };
        }),
    );
  const beforeSettings = await settings();
  const beforePosts = await readPanelPosts(panel);
  const tabs = await panel.$$eval('[data-panel-tabs] [role="tab"]', (nodes) =>
    nodes.map((node) => {
      const copy = node.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((child) => {
        child.remove();
      });
      return copy.textContent?.trim();
    }),
  );
  expect(tabs).toEqual(["投稿", "絞り込み条件"]);
  await selectPanelTab(panel, "posts");
  const afterPosts = new Set(
    (await readPanelPosts(panel)).map((post) => postKey(post.url)),
  );
  expect(beforePosts.every((post) => afterPosts.has(postKey(post.url)))).toBe(
    true,
  );
  await openFilterControls(panel);
  expect(await settings()).toEqual(beforeSettings);
}

export async function assertPanelPhoto(
  source: Page,
  panel: Page,
  site: "x" | "bluesky",
) {
  const expected = await source.$$eval(
    site === "x"
      ? 'article[data-testid="tweet"]'
      : '[data-testid^="feedItem-by-"]',
    (cards, service) =>
      cards.flatMap((card) => {
        const href =
          service === "x"
            ? card.querySelector("a:has(time[datetime])")?.getAttribute("href")
            : (card.getAttribute("href") ??
              card.querySelector('a[href*="/post/"]')?.getAttribute("href"));
        if (!href) return [];
        const selector =
          service === "x"
            ? '[data-testid="tweetPhoto"] img, a[href*="/photo/"] img'
            : 'button img, [role="button"] img';
        const images = [
          ...card.querySelectorAll<HTMLImageElement>(selector),
        ].flatMap((image) => {
          for (
            let parent = image.parentElement;
            parent && parent !== card;
            parent = parent.parentElement
          ) {
            if (
              parent.matches(
                'article[data-testid="tweet"], [data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]',
              ) ||
              (parent.matches('div[role="link"]') &&
                parent.querySelector(
                  '[data-testid="Tweet-User-Avatar"], [data-testid="userAvatarImage"], a[href*="/post/"]',
                ))
            )
              return [];
          }
          if (
            service === "bluesky" &&
            image.closest("a") &&
            image.closest("a") !== card
          )
            return [];
          return [image.currentSrc, image.src].filter((value) => {
            if (!URL.canParse(value)) return false;
            const url = new URL(value);
            return (
              url.protocol === "https:" &&
              (service === "x"
                ? url.hostname === "pbs.twimg.com" &&
                  url.pathname.startsWith("/media/")
                : url.hostname === "cdn.bsky.app" &&
                  /^\/img\/feed_(thumbnail|fullsize)\//.test(url.pathname))
            );
          });
        });
        return images.length
          ? [{ post: new URL(href, location.href).href, images }]
          : [];
      }),
    site,
  );
  expect(expected.length, "実サイトの本文写真があること").toBeGreaterThan(0);
  await selectPanelTab(panel, "posts");
  await readPanelPosts(panel);
  const imageKey = (value: string) => {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  };
  const find = async () => {
    const images = await panel.$$eval("a[data-post-link] img", (nodes) =>
      nodes.map((node) => ({
        post: (node.closest("a") as HTMLAnchorElement).href,
        src: (node as HTMLImageElement).src,
      })),
    );
    return images.find((image) =>
      expected.some(
        (post) =>
          postKey(post.post) === postKey(image.post) &&
          post.images.some((url) => imageKey(url) === imageKey(image.src)),
      ),
    );
  };
  await expect
    .poll(find, { message: "同一投稿の本文写真がパネルに表示されること" })
    .toBeTruthy();
  const image = await find();
  if (!image) throw Error("照合した投稿画像が消失しました");
  const handle = await panel.$(
    `a[data-post-link][href=${JSON.stringify(image.post)}] img[src=${JSON.stringify(image.src)}]`,
  );
  if (!handle) throw Error("照合した投稿画像を取得できません");
  try {
    // パネル内の1枚だけを表示位置へ移す。元サイトはスクロールしない。
    await handle.scrollIntoView();
    await expect
      .poll(
        () =>
          handle.evaluate((node) => {
            const img = node as HTMLImageElement;
            return img.complete && img.naturalWidth > 0;
          }),
        { message: "CDNの実画像が読み込まれること" },
      )
      .toBe(true);
    return handle.evaluate((node) => {
      const img = node as HTMLImageElement;
      return {
        post: (img.closest("a") as HTMLAnchorElement).href,
        image: img.currentSrc,
        complete: img.complete,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    });
  } finally {
    await handle.dispose();
  }
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
  await selectPanelTab(panel, "posts");
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
  tab: "posts" | "filters" = "posts",
): Promise<void> {
  await selectPanelTab(panel, tab);
  await panel.evaluate(
    (kind) =>
      document
        .querySelector<HTMLElement>(
          kind === "posts" ? "[data-posts-panel]" : "[data-filter-panel]",
        )
        ?.scrollTo(0, 0),
    tab,
  );
  await panel.screenshot({
    path: `${process.cwd()}/test-results/post-collection-panel-${site}${tab === "filters" ? "-filters" : ""}.png`,
    fullPage: false,
  });
}
