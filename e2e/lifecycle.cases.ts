import type { JSHandle, Page } from "puppeteer-core";
import { expect } from "vitest";
import { selectPartialChoice } from "../scripts/compatibility/filter-choice.ts";
import { aria, element, evidence, visible } from "./browser-queries.ts";
import { cases, lifecycleCases } from "./cases.ts";
import {
  acquireCasePage,
  assertLivePage,
  closePanel,
  completeInitialLoad,
  observeAutomaticPanelClose,
  openPanel,
  readContext,
  releaseCasePage,
} from "./live.ts";
import type { LiveCase } from "./live-case.ts";
import { selectNiconicoUserSort } from "./niconico-navigation.ts";

async function selectYoutube(page: Page, names: string | readonly string[]) {
  const tab = aria("tab", names);
  await page.locator(tab).wait();
  const selected = () =>
    page.$eval(
      tab,
      (node) =>
        node.getAttribute("aria-selected") === "true" ||
        node.matches(".ytTabShapeTabSelected, [selected]") ||
        !!node.querySelector(".ytTabShapeTabSelected"),
    );
  if (!(await selected())) await page.locator(tab).click();
  await expect.poll(selected).toBe(true);
}

async function selectBluesky(page: Page, name: string) {
  const tab = aria("tab", name);
  await page.locator(tab).wait();
  const selected = () =>
    page.$eval(tab, (node) => {
      const mark = node.querySelector('[style*="background-color"]');
      return (
        !!mark &&
        getComputedStyle(mark).display !== "none" &&
        mark.getBoundingClientRect().height > 0
      );
    });
  if (!(await selected())) await page.locator(tab).click();
  await expect.poll(selected).toBe(true);
}

export function createLifecycleCases(): LiveCase[] {
  const entries: LiveCase[] = [];
  for (const target of lifecycleCases) {
    const entry =
      target.site === "youtube" || target.site === "niconico"
        ? (cases.find(
            (candidate) =>
              candidate.id ===
              (target.site === "youtube"
                ? "youtube-chip-popular"
                : "niconico-popular"),
          )?.start ?? target.url)
        : target.url;
    entries.push({
      id: target.id,
      entry,
      run: async (session, task) => {
        const { page, reused } = await acquireCasePage(session, entry);
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(30000);
        let opened = false;
        let healthy = false;
        let cleanupError: unknown;
        try {
          await page.bringToFront();
          session.loadGuard.setContext(target.id, "navigate");
          if (!reused)
            await page.goto(target.url, { waitUntil: "domcontentloaded" });
          else if (target.site === "youtube" || target.site === "niconico") {
            const expected = new URL(target.url);
            const current = new URL(page.url());
            expect(current.origin).toBe(expected.origin);
            const root = expected.pathname.replace(/\/(videos|video)$/, "");
            expect(
              current.pathname === root ||
                current.pathname.startsWith(`${root}/`),
              "共有したページが検証対象のチャンネル・ユーザーであること",
            ).toBe(true);
            if (target.site === "youtube") await selectYoutube(page, "動画");
            else if (current.pathname !== expected.pathname)
              await page.locator(aria("link", "動画・シリーズ")).click();
            await expect
              .poll(() => new URL(page.url()).pathname)
              .toBe(expected.pathname);
          } else if (page.url() !== target.url)
            await page.goto(target.url, { waitUntil: "domcontentloaded" });
          await assertLivePage(session, page);
          if (target.site === "youtube") {
            await selectYoutube(page, [
              "人気の動画",
              "Popular",
              "Most popular",
            ]);
          }
          if (target.site === "niconico")
            await selectNiconicoUserSort(page, "再生数が多い順");
          if (target.site === "bluesky") await selectBluesky(page, "投稿");
          session.loadGuard.setContext(target.id, "initial-list");
          const initialListStarted = Date.now();
          // DOMContentLoadedではサイトのプロフィール・投稿APIは完了していない。
          // 通常ページと同じ初期表示の期限内で、実投稿を待つ。再取得はしない。
          await expect
            .poll(
              async () => {
                await assertLivePage(session, page);
                return visible(
                  page,
                  {
                    youtube: "ytd-rich-item-renderer",
                    niconico: ".NC-VideoMediaObject",
                    x: 'article[data-testid="tweet"]',
                    bluesky: '[data-testid^="feedItem-by-"]',
                  }[target.site],
                );
              },
              {
                timeout: 30000,
                message: "サイトが表示する初期一覧の実投稿を待機",
              },
            )
            .toBe(true);
          await evidence(task, "initial-list", {
            body: JSON.stringify({
              url: page.url(),
              waitMs: Date.now() - initialListStarted,
              visible: true,
            }),
            contentType: "application/json",
          });
          let panel = await openPanel(session, page);
          opened = true;
          await expect
            .poll(async () => (await readContext(session, page)).health?.state)
            .toBe("ready");
          const originalPageKey = (await readContext(session, page)).pageKey;
          const picker = `[data-minimum-picker] >>> ${aria("combobox")}`;
          await expect.poll(() => visible(panel, picker)).toBe(true);
          await panel
            .locator(picker)
            .setWaitForStableBoundingBox(false)
            .click();
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
            selectPartialChoice(
              counts.map((count, index) => ({ count, index })),
              counts[0] ?? 0,
            )?.index ?? -1;
          // 一覧の取得と候補件数の更新は、パネルの表示より後に完了する。
          await expect
            .poll(async () => partialIndex(await readCounts()), {
              message: "遷移前に投稿を除外できる条件が必要です",
            })
            .toBeGreaterThan(0);
          const counts = await readCounts();
          await completeInitialLoad(session, page, task, "ready");
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

          const closedWidth = await page.evaluate(() => innerWidth);
          const assertAutomaticClose = await observeAutomaticPanelClose(
            session,
            page,
          );
          if (target.site === "youtube")
            await page
              .locator(aria("tab", ["新しい順", "Latest", "Newest"]))
              .click();
          else if (target.site === "niconico")
            await selectNiconicoUserSort(page, "投稿日時が新しい順");
          else if (target.site === "bluesky")
            await page.locator(aria("tab", "フィード")).click();
          else {
            const profilePath = new URL(target.url).pathname;
            const findMainLink = (path: string) => {
              for (const article of document.querySelectorAll(
                'article[data-testid="tweet"]',
              )) {
                for (const link of article.querySelectorAll<HTMLAnchorElement>(
                  "a:has(time)",
                )) {
                  const pathname = new URL(link.href).pathname;
                  if (
                    pathname.startsWith(`${path}/status/`) &&
                    /^\d+$/.test(pathname.slice(`${path}/status/`.length)) &&
                    link.checkVisibility({ visibilityProperty: true })
                  )
                    return link;
                }
              }
              return null;
            };
            await expect
              .poll(async () => {
                const candidate = (await page.evaluateHandle(
                  findMainLink,
                  profilePath,
                )) as JSHandle<HTMLAnchorElement | null>;
                try {
                  return await candidate.evaluate((node) => Boolean(node));
                } finally {
                  await candidate.dispose();
                }
              })
              .toBe(true);
            const link = (await page.evaluateHandle(
              findMainLink,
              profilePath,
            )) as JSHandle<HTMLAnchorElement | null>;
            try {
              const destination = await link.evaluate((node) => node?.href);
              expect(
                destination,
                "プロフィール本人の投稿詳細リンクが存在すること",
              ).toBeTruthy();
              await link.evaluate((node) => node?.focus());
              await expect
                .poll(() =>
                  link.evaluate((node) => node === document.activeElement),
                )
                .toBe(true);
              await page.keyboard.press("Enter");
              await expect.poll(() => page.url()).toBe(destination);
              await evidence(task, "native-detail-navigation", {
                body: JSON.stringify({ destination, url: page.url() }),
                contentType: "application/json",
              });
            } finally {
              await link.dispose();
            }
          }
          await assertAutomaticClose();
          opened = false;
          await expect
            .poll(
              async () => (await readContext(session, page)).filteringEnabled,
            )
            .toBe(false);
          await expect
            .poll(() =>
              page.$$eval(
                '[data-sift-filter-state="hidden"]',
                (nodes) => nodes.length,
              ),
            )
            .toBe(0);
          await expect
            .poll(
              async () => (await readContext(session, page)).timelineAvailable,
            )
            .toBe(false);

          if (target.site === "youtube")
            await page
              .locator(aria("tab", ["人気の動画", "Popular", "Most popular"]))
              .click();
          else if (target.site === "niconico")
            await selectNiconicoUserSort(page, "再生数が多い順");
          else if (target.site === "bluesky")
            await page.locator(aria("tab", "投稿")).click();
          else await page.goBack({ waitUntil: "domcontentloaded" });
          // 一覧へ戻っても明示アクションまでは閉じたまま、絞り込みも再開しない。
          await expect
            .poll(async () => (await readContext(session, page)).pageKey)
            .toBe(originalPageKey);
          await expect
            .poll(
              async () => (await readContext(session, page)).timelineAvailable,
            )
            .toBe(true);
          await expect
            .poll(
              async () => (await readContext(session, page)).filteringEnabled,
            )
            .toBe(false);
          await expect
            .poll(() => page.evaluate(() => innerWidth))
            .toBeGreaterThan(closedWidth);
          await expect
            .poll(() =>
              page.$$eval(
                '[data-sift-filter-state="hidden"]',
                (nodes) => nodes.length,
              ),
            )
            .toBe(0);
          panel = await openPanel(session, page);
          opened = true;
          await expect
            .poll(() =>
              panel.$eval(
                `[data-minimum-picker] >>> ${aria("combobox")}`,
                (node) => (node.textContent ?? "").trim(),
              ),
            )
            .toContain("指定なし");
          await evidence(task, "lifecycle", {
            body: JSON.stringify({
              stages: [
                "filtered",
                "navigation-closed-cleared",
                "returned-inactive",
                "reopened-reset",
              ],
            }),
            contentType: "application/json",
          });
          healthy = true;
        } catch (error) {
          await evidence(task, "failure-native-page", {
            body: JSON.stringify(
              await page.evaluate(() => ({
                url: location.href,
                title: document.title,
                readyState: document.readyState,
                loadingIndicators: [
                  ...document.querySelectorAll('[role="progressbar"]'),
                ].filter((node) =>
                  node.checkVisibility({ visibilityProperty: true }),
                ).length,
                alerts: [
                  ...document.querySelectorAll(
                    '[role="alert"], [data-testid="errorMessage"]',
                  ),
                ]
                  .filter((node) =>
                    node.checkVisibility({ visibilityProperty: true }),
                  )
                  .map((node) => node.textContent?.trim()),
                activeHref: document.activeElement?.getAttribute("href"),
                dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
                  (node) => ({
                    visible: node.checkVisibility({ visibilityProperty: true }),
                    label: node.getAttribute("aria-label"),
                  }),
                ),
                timestampLinks: [
                  ...document.querySelectorAll(
                    'article[data-testid="tweet"] a:has(time)',
                  ),
                ].map((node) => ({
                  href: node.getAttribute("href"),
                  visible: node.checkVisibility({ visibilityProperty: true }),
                })),
              })),
            ),
            contentType: "application/json",
          }).catch(() => {});
          throw error;
        } finally {
          try {
            if (opened || session.panelTargetId)
              await closePanel(session, page);
          } catch (error) {
            healthy = false;
            cleanupError = error;
          } finally {
            await releaseCasePage(session, entry, healthy);
          }
        }
        if (cleanupError) throw cleanupError;
      },
    });
  }
  return entries;
}
