import { expect } from "vitest";
import { aria, element, evidence, text, visible } from "./browser-queries.ts";
import { lightboxCases } from "./cases.ts";
import {
  acquireCasePage,
  assertLivePage,
  closePanel,
  completeInitialLoad,
  openPanel,
  readContext,
  releaseCasePage,
} from "./live.ts";
import type { LiveCase } from "./live-case.ts";
import {
  assertPageReadOnly,
  openFilterControls,
  postKey,
  readPanelPosts,
} from "./panel-posts.ts";

export function createLightboxCases(): LiveCase[] {
  const entries: LiveCase[] = [];
  for (const target of lightboxCases) {
    entries.push({
      id: target.id,
      entry: target.url,
      run: async (session, task) => {
        const { page, reused } = await acquireCasePage(session, target.url);
        let opened = false;
        let healthy = false;
        let cleanupError: unknown;
        const profilePath = new URL(target.url).pathname;
        try {
          page.setDefaultTimeout(30000);
          if (!reused || page.url() !== target.url) {
            await page.goto(target.url, { waitUntil: "domcontentloaded" });
          }
          await assertLivePage(session, page);
          const profileTab = `a[role="tab"][href="${profilePath}"]`;
          await page.locator(profileTab).wait();
          if (
            await page.$eval(
              profileTab,
              (node) => node.getAttribute("aria-selected") !== "true",
            )
          )
            await page.locator(profileTab).click();
          // 画面外の画像はサイトがリンクを準備する前に遅延読み込み領域だけを出す。
          // 実投稿の画像領域へ一度だけ移動し、サイト自身の画像リンクを待つ。
          await page
            .locator('article[data-testid="tweet"] [data-testid="tweetPhoto"]')
            .wait();
          const imageRegion = await element(
            page,
            'article[data-testid="tweet"] [data-testid="tweetPhoto"]',
          );
          await imageRegion.scrollIntoView();
          await imageRegion.dispose();
          await page
            .locator('article[data-testid="tweet"] a[href*="/photo/"]')
            .wait();
          const panel = await openPanel(session, page);
          opened = true;
          await expect
            .poll(async () => (await readContext(session, page)).health?.state)
            .toBe("ready");
          await completeInitialLoad(session, page, task, "ready");
          await openFilterControls(panel);
          const mediaPicker = aria("combobox", "コンテンツタイプ");
          await (await element(panel, mediaPicker)).click();
          await (
            await element(panel, aria("option", "画像・動画のみ"))
          ).click();
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
          await assertPageReadOnly(page);
          expect(before.collectedCount).toBeGreaterThan(0);
          const photoHref = await photoLink.evaluate((node) =>
            node.getAttribute("href"),
          );
          expect(photoHref).toMatch(/\/status\/\d+\/photo\/\d+$/);
          await photoLink.dispose();
          // パネル操作後も実リンクへのクリックでページへ入力を戻す。
          // Locatorで現在の要素と位置の安定を確認し、仮想化で古いhandleを使わない。
          await page
            .locator(
              `article[data-testid="tweet"] a[href=${JSON.stringify(photoHref)}]`,
            )
            .click();
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
          const collectedBefore = new Set(
            (await readPanelPosts(panel)).map((post) => postKey(post.url)),
          );
          const sampleMatchesBackground = async () => {
            const context = await readContext(session, page);
            const posts = new Set(
              (await readPanelPosts(panel)).map((post) => postKey(post.url)),
            );
            return (
              context.pageKey === before.pageKey &&
              collectedBefore.size > 0 &&
              [...collectedBefore].every((key) => posts.has(key))
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
          await expect
            .poll(() => new URL(page.url()).pathname)
            .toBe(profilePath);
          await expect
            .poll(() =>
              visible(page, '[role="dialog"] img[src*="pbs.twimg.com/media/"]'),
            )
            .toBe(false);
          await expect.poll(sampleMatchesBackground).toBe(true);
          expect(await selected()).toBe("画像・動画のみ");
          await assertPageReadOnly(page);
          await closePanel(session, page);
          opened = false;

          // 元一覧を持たない直接アクセスは、画像詳細を対応一覧とみなさない。
          await page.goto(photoUrl, { waitUntil: "domcontentloaded" });
          await assertLivePage(session, page);
          const directPanel = await openPanel(session, page);
          opened = true;
          await expect
            .poll(() =>
              visible(directPanel, text("このページはフィルター対象外です")),
            )
            .toBe(true);
          await expect
            .poll(
              async () => (await readContext(session, page)).timelineAvailable,
            )
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
          healthy = true;
        } finally {
          if (!healthy && !page.isClosed()) {
            await evidence(task, "lightbox-native-state", {
              body: JSON.stringify(
                await page
                  .evaluate(() => ({
                    url: location.href,
                    cards: document.querySelectorAll(
                      'article[data-testid="tweet"]',
                    ).length,
                    photos: Array.from(
                      document.querySelectorAll(
                        'article[data-testid="tweet"] [data-testid="tweetPhoto"]',
                      ),
                    ).map((node) => ({
                      images: Array.from(node.querySelectorAll("img")).map(
                        (img) => ({
                          complete: img.complete,
                          media: img.src.includes("pbs.twimg.com/media/"),
                        }),
                      ),
                      loading: Boolean(
                        node.querySelector('[role="progressbar"]'),
                      ),
                      video: Boolean(
                        node.querySelector(
                          'video,[data-testid="videoPlayer"],[data-testid="previewInterstitial"]',
                        ),
                      ),
                      rect: {
                        top: node.getBoundingClientRect().top,
                        height: node.getBoundingClientRect().height,
                      },
                      link: node.closest("a")?.getAttribute("href"),
                    })),
                  }))
                  .catch((problem) => ({ error: String(problem) })),
              ),
              contentType: "application/json",
            });
          }
          try {
            if (opened || session.panelTargetId)
              await closePanel(session, page);
          } catch (error) {
            healthy = false;
            cleanupError = error;
          } finally {
            await releaseCasePage(session, target.url, healthy);
          }
        }
        if (cleanupError) throw cleanupError;
      },
    });
  }
  return entries;
}
