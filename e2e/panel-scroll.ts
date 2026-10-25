import type { Page } from "puppeteer-core";
import { expect } from "vitest";

export async function narrowPanelWindow(
  page: Page,
): Promise<() => Promise<void>> {
  const target = await page.createCDPSession();
  let targetId: string;
  try {
    targetId = (await target.send("Target.getTargetInfo")).targetInfo.targetId;
  } finally {
    await target.detach();
  }
  const cdp = await page.browser().target().createCDPSession();
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget", {
      targetId,
    });
    const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });
    const restore = async () => {
      try {
        await cdp.send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "normal" },
        });
        const { left, top, width, height, windowState } = bounds;
        await cdp.send("Browser.setWindowBounds", {
          windowId,
          bounds: { left, top, width, height },
        });
        if (windowState && windowState !== "normal")
          await cdp.send("Browser.setWindowBounds", {
            windowId,
            bounds: { windowState },
          });
      } finally {
        await cdp.detach();
      }
    };
    try {
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { width: 960 },
      });
      await expect
        .poll(
          async () =>
            (await cdp.send("Browser.getWindowBounds", { windowId })).bounds
              .width,
        )
        .toBe(960);
    } catch (error) {
      await restore();
      throw error;
    }
    return restore;
  } catch (error) {
    if (!cdp.detached) await cdp.detach();
    throw error;
  }
}

export async function readPanelScrollAnchor(page: Page, postId?: string) {
  return page.evaluate((postId) => {
    for (const card of document.querySelectorAll(
      'article[data-testid="tweet"]',
    )) {
      const href = card
        .querySelector('a[href*="/status/"] time')
        ?.closest("a")
        ?.getAttribute("href");
      const id = /\/status\/(\d+)/.exec(href ?? "")?.[1];
      const cell = card.closest('[data-testid="cellInnerDiv"]') ?? card;
      const { top, bottom, height, left, right } = cell.getBoundingClientRect();
      const visibleTop = Math.max(top, 0);
      const visibleBottom = Math.min(bottom, innerHeight);
      const visibleLeft = Math.max(left, 0);
      const visibleRight = Math.min(right, innerWidth);
      const hit =
        visibleBottom > visibleTop && visibleRight > visibleLeft
          ? document.elementFromPoint(
              (visibleLeft + visibleRight) / 2,
              (visibleTop + visibleBottom) / 2,
            )
          : null;
      if (
        id &&
        height > 0 &&
        (postId ? id === postId : hit !== null && cell.contains(hit))
      )
        return { id, top };
    }
    return null;
  }, postId);
}

export async function scrollToPanelAnchor(page: Page) {
  const point = await page.$eval('[data-testid="primaryColumn"]', (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: innerHeight / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel({ deltaY: 1600 });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
  let previous: Awaited<ReturnType<typeof readPanelScrollAnchor>> = null;
  let stable = 0;
  await expect
    .poll(
      async () => {
        const current = await readPanelScrollAnchor(page);
        stable =
          current &&
          previous?.id === current.id &&
          Math.abs(previous.top - current.top) <= 1
            ? stable + 1
            : 0;
        previous = current;
        return stable;
      },
      { interval: 150, timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(2);
  const anchor = await readPanelScrollAnchor(page);
  if (!anchor) throw new Error("スクロール後の実投稿を特定できません");
  return anchor;
}

export async function assertPanelScrollAnchor(
  page: Page,
  anchor: { id: string; top: number },
): Promise<void> {
  let stable = 0;
  await expect
    .poll(
      async () => {
        const current = await readPanelScrollAnchor(page, anchor.id);
        stable =
          current && Math.abs(current.top - anchor.top) <= 2 ? stable + 1 : 0;
        return stable;
      },
      { interval: 200, timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(3);
}
