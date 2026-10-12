import { afterAll, beforeAll, expect, test } from "vitest";
import { aria, element, evidence, text, visible } from "./browser-queries.ts";
import { lightboxCases } from "./cases.ts";
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

for (const target of lightboxCases) {
  test(target.id, async ({ task }) => {
    const page = await session.context.newPage();
    let opened = false;
    try {
      page.setDefaultTimeout(30000);
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      await page.locator('a[role="tab"][href="/AdamasMC"]').click();
      await page
        .locator('article[data-testid="tweet"] a[href*="/photo/"]')
        .wait();
      const panel = await openPanel(session, page);
      opened = true;
      await expect
        .poll(async () => (await readContext(session, page)).health?.state)
        .toBe("ready");
      const mediaPicker = aria("combobox", "コンテンツタイプ");
      await (await element(panel, mediaPicker)).click();
      await (await element(panel, aria("option", "画像・動画のみ"))).click();
      const selected = () =>
        panel.$eval(mediaPicker, (node) => (node.textContent ?? "").trim());
      await expect.poll(selected).toBe("画像・動画のみ");
      await expect
        .poll(() =>
          visible(page, 'article[data-testid="tweet"] a[href*="/photo/"]'),
        )
        .toBe(true);
      await page.bringToFront();
      // パネル幅変更後の位置復元を、利用者のスクロールで終了して画像へ進む。
      await page.mouse.wheel({ deltaY: 700 });
      const photoLink = await element(
        page,
        'article[data-testid="tweet"] a[href*="/photo/"]',
      );
      await photoLink.scrollIntoView();
      const before = await readContext(session, page);
      expect(before.timelineAvailable).toBe(true);
      expect(before.filteringEnabled).toBe(true);
      expect(before.metricSampleCount).toBeGreaterThan(0);
      await photoLink.press("Enter");
      await photoLink.dispose();
      await expect
        .poll(() => new URL(page.url()).pathname)
        .toMatch(/\/status\/\d+\/photo\/\d+$/);
      await expect
        .poll(() =>
          visible(page, '[role="dialog"] img[src*="pbs.twimg.com/media/"]'),
        )
        .toBe(true);
      const photoUrl = page.url();
      // スクロールで実投稿が増えることは許容し、現在の背景一覧と照合する。
      const sampleMatchesBackground = async () => {
        const context = await readContext(session, page);
        const backgroundCount = await page.$$eval(
          'article[data-testid="tweet"]',
          (cards) =>
            cards.filter(
              (card) =>
                !card.closest('[role="dialog"]') &&
                !card.parentElement?.closest('article[data-testid="tweet"]') &&
                card.querySelector(
                  '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], video, a[href*="/photo/"], a[href*="/video/"]',
                ),
            ).length,
        );
        return (
          context.pageKey === before.pageKey &&
          context.metricSampleCount === backgroundCount &&
          backgroundCount > 0
        );
      };
      await expect.poll(sampleMatchesBackground).toBe(true);
      await expect
        .poll(async () => (await readContext(session, page)).health?.state)
        .toBe("ready");
      expect(await selected()).toBe("画像・動画のみ");
      expect(
        await visible(panel, text("このページはフィルター対象外です")),
      ).toBe(false);
      expect(
        await page.$$eval(
          '[role="dialog"] img[src*="pbs.twimg.com/media/"]',
          (nodes) =>
            nodes.some(
              (node) =>
                !node.closest('[data-sift-filter-state="hidden"]') &&
                node.checkVisibility({ visibilityProperty: true }),
            ),
        ),
      ).toBe(true);
      expect(
        await page.$$eval(
          '[role="dialog"] article[data-testid="tweet"]',
          (nodes) =>
            nodes.every(
              (node) =>
                !node.closest('[data-sift-filter-state="hidden"]') &&
                node.checkVisibility({ visibilityProperty: true }),
            ),
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect.poll(() => new URL(page.url()).pathname).toBe("/AdamasMC");
      await expect
        .poll(() =>
          visible(page, '[role="dialog"] img[src*="pbs.twimg.com/media/"]'),
        )
        .toBe(false);
      await expect.poll(sampleMatchesBackground).toBe(true);
      expect(await selected()).toBe("画像・動画のみ");
      await closePanel(session, page);
      opened = false;

      // 元一覧を持たない直接アクセスは、画像詳細を対応一覧とみなさない。
      await page.goto(photoUrl, { waitUntil: "domcontentloaded" });
      const directPanel = await openPanel(session, page);
      opened = true;
      await expect
        .poll(() =>
          visible(directPanel, text("このページはフィルター対象外です")),
        )
        .toBe(true);
      await expect
        .poll(async () => (await readContext(session, page)).timelineAvailable)
        .toBe(false);
      expect(
        await directPanel.$$eval(aria("combobox"), (nodes) => nodes.length),
      ).toBe(0);
      expect(
        await page.$$eval(
          '[data-sift-filter-state="hidden"]',
          (nodes) => nodes.length,
        ),
      ).toBe(0);
      await evidence(task, "lightbox-gate", {
        body: JSON.stringify({
          settingPreserved: true,
          contextPreserved: true,
          modalVisible: true,
          closedRestored: true,
          directUnsupported: true,
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
