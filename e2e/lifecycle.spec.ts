import type { Page } from "puppeteer-core";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  aria,
  clickVisible,
  element,
  evidence,
  text,
  visible,
} from "./browser-queries.ts";
import { lifecycleCases } from "./cases.ts";
import {
  closePanel,
  connectLive,
  finishLive,
  type LiveSession,
  openPanel,
  readContext,
} from "./live.ts";

let session: LiveSession;
beforeAll(async () => {
  session = await connectLive();
});
afterAll(async () => {
  if (session) await finishLive(session);
});

async function chooseNico(page: Page, label: string) {
  await page.locator(".Selectbox-button").click();
  await page.locator(text(label)).click();
}

for (const target of lifecycleCases) {
  test(target.id, async ({ task }) => {
    const page = await session.context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(30000);
    let opened = false;
    try {
      await page.bringToFront();
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      if (target.site === "youtube") {
        await page
          .locator(aria("tab", ["人気の動画", "Popular", "Most popular"]))
          .click();
      }
      if (target.site === "bluesky")
        await page.locator(aria("tab", "投稿")).click();
      await expect
        .poll(() =>
          visible(
            page,
            {
              youtube: "ytd-rich-item-renderer",
              niconico: ".NC-VideoMediaObject",
              x: 'article[data-testid="tweet"]',
              bluesky: '[data-testid^="feedItem-by-"]',
            }[target.site],
          ),
        )
        .toBe(true);
      let panel = await openPanel(session, page);
      opened = true;
      await expect
        .poll(async () => (await readContext(session, page)).health?.state)
        .toBe("ready");
      const picker = `[data-minimum-picker] >>> ${aria("combobox")}`;
      await expect.poll(() => visible(panel, picker)).toBe(true);
      await panel.locator(picker).setWaitForStableBoundingBox(false).click();
      const options = aria("option");
      await expect.poll(() => visible(panel, options)).toBe(true);
      const readCounts = () =>
        panel.$$eval(options, (nodes) =>
          nodes.map((node) =>
            Number(
              node
                .querySelector("[data-choice-count]")
                ?.textContent?.replace(/[^\d]/g, ""),
            ),
          ),
        );
      const partialIndex = (counts: number[]) =>
        counts.findIndex(
          (count, i) => i > 0 && count > 0 && count < (counts[0] ?? 0),
        );
      // 一覧の取得と候補件数の更新は、パネルの表示より後に完了する。
      await expect
        .poll(async () => partialIndex(await readCounts()), {
          message: "遷移前に投稿を除外できる条件が必要です",
        })
        .toBeGreaterThan(0);
      const counts = await readCounts();
      const index = partialIndex(counts);
      await evidence(task, "lifecycle-filter-counts", {
        body: JSON.stringify({ counts, index }),
        contentType: "application/json",
      });
      await (await element(panel, options, index)).click();
      await expect
        .poll(() =>
          page.$$eval(
            '[data-sift-filter-state="hidden"]',
            (nodes) => nodes.length,
          ),
        )
        .toBeGreaterThan(0);

      if (target.site === "youtube")
        await page
          .locator(aria("tab", ["新しい順", "Latest", "Newest"]))
          .click();
      else if (target.site === "niconico")
        await chooseNico(page, "投稿日時が新しい順");
      else if (target.site === "bluesky")
        await page.locator(aria("tab", "フィード")).click();
      else
        await clickVisible(
          page,
          () =>
            Array.from(
              document.querySelectorAll(
                'article[data-testid="tweet"] a:has(time)',
              ),
            ).find((node) =>
              node.checkVisibility({ visibilityProperty: true }),
            ) ?? null,
        );
      await expect
        .poll(() => visible(panel, text("このページはフィルター対象外です")))
        .toBe(true);
      await expect
        .poll(() => panel.$$eval(aria("combobox"), (nodes) => nodes.length))
        .toBe(0);
      await expect
        .poll(() =>
          page.$$eval(
            '[data-sift-filter-state="hidden"]',
            (nodes) => nodes.length,
          ),
        )
        .toBe(0);
      await expect
        .poll(async () => (await readContext(session, page)).timelineAvailable)
        .toBe(false);

      if (target.site === "youtube")
        await page
          .locator(aria("tab", ["人気の動画", "Popular", "Most popular"]))
          .click();
      else if (target.site === "niconico")
        await chooseNico(page, "再生数が多い順");
      else if (target.site === "bluesky")
        await page.locator(aria("tab", "投稿")).click();
      else await page.goBack({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => (await readContext(session, page)).health?.state)
        .toBe("ready");
      await expect
        .poll(() =>
          visible(panel, `[data-minimum-picker] >>> ${aria("combobox")}`),
        )
        .toBe(true);
      await closePanel(session, page);
      opened = false;
      panel = await openPanel(session, page);
      opened = true;
      await expect
        .poll(() =>
          panel.$eval(`[data-minimum-picker] >>> ${aria("combobox")}`, (node) =>
            (node.textContent ?? "").trim(),
          ),
        )
        .toContain("指定なし");
      await evidence(task, "lifecycle", {
        body: JSON.stringify({
          stages: [
            "filtered",
            "unsupported-cleared",
            "supported",
            "reopened-reset",
          ],
        }),
        contentType: "application/json",
      });
    } finally {
      try {
        if (opened || session.panelTargetId) await closePanel(session, page);
      } finally {
        await page.close();
      }
    }
  });
}
