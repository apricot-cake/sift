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
    // 未表示の収集済み投稿がある間だけ展開し、追加取得は開始しない。
    for (let count = 0; count < 20; count += 1) {
      const more = await panel.$('[data-has-more-collected="true"]');
      if (!more) break;
      await more.dispose();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const pane = await panel.$("[data-posts-panel]");
      if (!pane) throw Error("投稿タブのスクロール領域がありません");
      try {
        const before = await panel.$$eval(
          "a[data-post-link]",
          (links) => links.length,
        );
        // 照合用の準備は同一タスク内で行い、画像の遅延描画やパネルの入力フォーカスに依存させない。
        // 外部取得の実機ケースでは、別途ネイティブのホイール・キー・タッチ入力を使う。
        const expanded = await pane.evaluate((node) => {
          if (!node.querySelector('[data-has-more-collected="true"]'))
            return false;
          const element = node as HTMLElement;
          element.scrollTop = element.scrollHeight;
          element.dispatchEvent(
            new KeyboardEvent("keydown", { key: "End", bubbles: true }),
          );
          return true;
        });
        if (!expanded) continue;
        await expect
          .poll(
            () => panel.$$eval("a[data-post-link]", (links) => links.length),
            { timeout: 3000 },
          )
          .toBeGreaterThan(before);
      } finally {
        await pane.dispose();
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

/** 各サービスの追加取得を代表ページで1回だけ行い、到達位置の保持と取得の停止を照合する。 */
export async function assertPanelLoadsOneBatch(
  source: Page,
  panel: Page,
  site: "x" | "bluesky",
  trigger: "panel-scroll" | "panel-key" | "panel-touch" = site === "x"
    ? "panel-scroll"
    : "panel-key",
) {
  await selectPanelTab(panel, "posts");
  const selector =
    site === "x"
      ? 'article[data-testid="tweet"]'
      : '[data-testid^="feedItem-by-"]';
  const readPosition = () =>
    source.evaluate(
      ({ selector, site }) => {
        const visiblePostIds: string[] = [];
        let scrollTop: number | null = null;
        let scrollElement: {
          tag: string;
          testId: string | null;
          scrollTop: number;
          scrollHeight: number;
          clientHeight: number;
        } | null = null;
        for (const card of document.querySelectorAll(selector)) {
          const cell =
            site === "x"
              ? (card.closest('[data-testid="cellInnerDiv"]') ?? card)
              : card;
          const rect = cell.getBoundingClientRect();
          const href =
            site === "x"
              ? card
                  .querySelector("a:has(time[datetime])")
                  ?.getAttribute("href")
              : (card.getAttribute("href") ??
                card.querySelector('a[href*="/post/"]')?.getAttribute("href"));
          const left = Math.max(0, rect.left);
          const right = Math.min(innerWidth, rect.right);
          const top = Math.max(0, rect.top);
          const bottom = Math.min(innerHeight, rect.bottom);
          if (!href || rect.height <= 0 || left >= right || top >= bottom)
            continue;
          const hit = document.elementFromPoint(
            (left + right) / 2,
            (top + bottom) / 2,
          );
          if (!hit || !cell.contains(hit)) continue;
          visiblePostIds.push(href);
          if (scrollTop === null) {
            let scrolling: Element | null = cell.parentElement;
            while (
              scrolling &&
              scrolling !== document.body &&
              scrolling !== document.documentElement
            ) {
              const style = getComputedStyle(scrolling);
              if (
                /(auto|scroll)/.test(style.overflowY) &&
                scrolling.clientHeight > 0 &&
                scrolling.scrollHeight > scrolling.clientHeight
              )
                break;
              scrolling = scrolling.parentElement;
            }
            const selected =
              scrolling &&
              scrolling !== document.body &&
              scrolling !== document.documentElement
                ? scrolling
                : document.scrollingElement;
            scrollTop = selected?.scrollTop ?? scrollY;
            if (selected)
              scrollElement = {
                tag: selected.tagName,
                testId: selected.getAttribute("data-testid"),
                scrollTop: selected.scrollTop,
                scrollHeight: selected.scrollHeight,
                clientHeight: selected.clientHeight,
              };
          }
        }
        return scrollTop === null
          ? null
          : {
              scrollTop,
              visiblePostIds,
              windowY: scrollY,
              documentY: document.scrollingElement?.scrollTop ?? null,
              scrollElement,
            };
      },
      { selector, site },
    );
  if (!(await readPosition())) {
    // プロフィールヘッダーや復帰後の位置に投稿が無ければ、実投稿1件だけを準備位置へ移す。
    // 追加取得の操作前に、ここから先へ進むことを検証する開始位置を定める。
    const cards = await source.$$(selector);
    let prepared = false;
    try {
      for (const card of cards) {
        if (!(await card.isVisible())) continue;
        await card.scrollIntoView();
        prepared = true;
        break;
      }
    } finally {
      await Promise.all(cards.map((card) => card.dispose()));
    }
    expect(prepared, "検証準備で実投稿1件を表示位置へ移せること").toBe(true);
  }
  await expect.poll(readPosition, { timeout: 5000 }).not.toBeNull();
  const originalPosition = await readPosition();
  if (!originalPosition) throw Error("開始位置の可視投稿を取得できません");
  const originalPost = originalPosition.visiblePostIds[0];
  if (!originalPost) throw Error("開始位置の投稿IDを取得できません");
  await expect
    .poll(async () =>
      (await readPanelPosts(panel)).some(
        (post) => postKey(post.url) === postKey(originalPost, source.url()),
      ),
    )
    .toBe(true);
  const before = new Set(
    (await readPanelPosts(panel)).map((post) => postKey(post.url)),
  );
  const originalUrl = source.url();
  const beforeRequests = await panel.$eval(
    "[data-load-request-count]",
    (node) => Number(node.getAttribute("data-load-request-count")),
  );
  expect(beforeRequests, "明示操作前に追加取得を開始していないこと").toBe(0);

  {
    // 前の操作意図を残さず、拡張パネルだけを取得開始直前の位置へ準備する。
    await new Promise((resolve) => setTimeout(resolve, 850));
    const statusBefore = await panel.$$eval(
      "[data-load-more-status]",
      (nodes) => nodes.map((node) => node.getAttribute("data-status")),
    );
    const pane = await panel.$("[data-posts-panel]");
    if (!pane) throw Error("投稿タブのスクロール領域がありません");
    try {
      await pane.evaluate((node, trigger) => {
        const element = node as HTMLElement;
        const last = element.scrollHeight - element.clientHeight;
        if (trigger === "panel-scroll" && last <= 60)
          throw Error("実スクロールに必要な投稿の高さがありません");
        element.scrollTop =
          trigger === "panel-scroll" ? last - 180 : Math.max(0, last);
      }, trigger);
      // プログラムによる準備だけでは追加取得を開始しない。
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(
        await panel.$$eval("[data-load-more-status]", (nodes) =>
          nodes.map((node) => node.getAttribute("data-status")),
        ),
      ).toEqual(statusBefore);
      const rect = await pane.boundingBox();
      if (!rect) throw Error("投稿タブの実スクロール位置を取得できません");
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      if (trigger === "panel-scroll") {
        await panel.mouse.move(x, y);
        await panel.mouse.wheel({ deltaY: 160 });
      } else if (trigger === "panel-key") {
        await pane.focus();
        await panel.keyboard.press("PageDown");
      } else {
        const touch = await panel.createCDPSession();
        try {
          await touch.send("Emulation.setTouchEmulationEnabled", {
            enabled: true,
          });
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y, id: 1 }],
          });
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y: y - 100, id: 1 }],
          });
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        } finally {
          await touch.send("Emulation.setTouchEmulationEnabled", {
            enabled: false,
          });
          await touch.detach();
        }
      }
    } finally {
      await pane.dispose();
    }
  }
  const result = () =>
    panel.$eval("[data-load-more-status]", (node) => ({
      status: node.getAttribute("data-status"),
      added: Number(node.getAttribute("data-added")),
      requestCount: Number(node.getAttribute("data-request-count")),
    }));
  await expect
    .poll(result, {
      timeout: 15000,
      message: "1回の明示操作で新しい投稿を収集できること",
    })
    .toMatchObject({ status: "loaded" });
  const loaded = await result();
  expect(loaded.added).toBeGreaterThan(0);
  expect(loaded.requestCount).toBe(beforeRequests + 1);
  expect(source.url()).toBe(originalUrl);
  const after = new Set(
    (await readPanelPosts(panel)).map((post) => postKey(post.url)),
  );
  expect([...before].every((key) => after.has(key))).toBe(true);
  const newPosts = [...after].filter((key) => !before.has(key));
  expect(
    newPosts.length,
    "前からある投稿の再表示だけではないこと",
  ).toBeGreaterThan(0);
  const newPostKeys = new Set(newPosts);
  const visibleNewPosts = (
    position: Awaited<ReturnType<typeof readPosition>>,
  ) =>
    position?.visiblePostIds.filter((id) =>
      newPostKeys.has(postKey(id, originalUrl)),
    ) ?? [];
  let lastPosition: Awaited<ReturnType<typeof readPosition>> = null;
  try {
    await expect
      .poll(
        async () => {
          lastPosition = await readPosition();
          return (
            lastPosition !== null &&
            lastPosition.scrollTop > originalPosition.scrollTop + 1 &&
            visibleNewPosts(lastPosition).length > 0
          );
        },
        {
          timeout: 5000,
          message: "元ページが読み進めた位置にあり、新しい投稿が見えること",
        },
      )
      .toBe(true);
  } catch (cause) {
    throw new Error(
      `追加取得後の位置確認に失敗しました: ${JSON.stringify({
        originalPosition,
        lastPosition,
        newPostCount: newPosts.length,
        visibleNewPostCount: visibleNewPosts(lastPosition).length,
      })}`,
      { cause },
    );
  }
  const reachedPosition = await readPosition();
  if (!reachedPosition) throw Error("追加取得後の到達位置を取得できません");
  // 取得の完了や追加したカードのレイアウトだけでは、次の取得を始めない。
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect(await result()).toEqual(loaded);
  const afterQuiet = new Set(
    (await readPanelPosts(panel)).map((post) => postKey(post.url)),
  );
  // サイト自身の遅延描画は通常の収集にも反映されるため、件数固定では判定しない。
  expect([...after].every((key) => afterQuiet.has(key))).toBe(true);
  const quietPosition = await readPosition();
  expect(quietPosition, "操作しない間も実投稿が見えること").not.toBeNull();
  if (!quietPosition) throw Error("待機後の到達位置を取得できません");
  expect(
    quietPosition.scrollTop,
    "操作しない間に開始位置へ巻き戻されないこと",
  ).toBeGreaterThan(originalPosition.scrollTop + 1);
  expect(visibleNewPosts(quietPosition).length).toBeGreaterThan(0);
  const sameVisiblePost = visibleNewPosts(quietPosition).some((id) =>
    reachedPosition.visiblePostIds.includes(id),
  );
  expect(
    Math.abs(quietPosition.scrollTop - reachedPosition.scrollTop) <= 2 ||
      sameVisiblePost,
    "到達座標か、同じ新しい可視投稿が維持されること",
  ).toBe(true);
  await assertPageReadOnly(source);
  // 完了状態だけを撮るため、拡張パネル内の末尾へ移す。元ページは操作しない。
  await panel.evaluate(() => {
    const pane = document.querySelector<HTMLElement>("[data-posts-panel]");
    pane?.scrollTo(0, pane.scrollHeight);
  });
  await panel.screenshot({
    path: `${process.cwd()}/test-results/post-load-more-${site}.png`,
    fullPage: false,
  });
  const loadControl = await panel.$("[data-load-more-hint]");
  if (!loadControl) throw Error("取得完了後の操作ヒントがありません");
  try {
    await loadControl.screenshot({
      path: `${process.cwd()}/test-results/post-load-more-hint-${site}.png`,
    });
  } finally {
    await loadControl.dispose();
  }
  return {
    trigger,
    status: loaded.status,
    added: loaded.added,
    requestCount: loaded.requestCount,
    collectedAfterQuiet: afterQuiet.size,
    newPosts: newPosts.length,
    retained: before.size,
    originalScrollTop: originalPosition.scrollTop,
    reachedScrollTop: reachedPosition.scrollTop,
    quietScrollTop: quietPosition.scrollTop,
    reachedVisiblePosts: reachedPosition.visiblePostIds,
    quietVisiblePosts: quietPosition.visiblePostIds,
    continuedWithoutInput: false,
  };
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
