import type { JSHandle, Page } from "puppeteer-core";
import { expect } from "vitest";
import { rethrowWithDiagnostics } from "../scripts/compatibility/failure-diagnostics.ts";
import { selectPartialChoice } from "../scripts/compatibility/filter-choice.ts";
import { parseMetric } from "../utils/filter-core.ts";
import type { ReactionSiteSettings } from "../utils/settings.ts";
import { aria, evidence, fillNumber, visible } from "./browser-queries.ts";
import { lifecycleCases } from "./cases.ts";
import {
  acquireCasePage,
  assertLivePage,
  clearSiteConditions,
  closePanel,
  completeInitialLoad,
  observeAutomaticPanelClose,
  openPanel,
  readContext,
  releaseCasePage,
} from "./live.ts";
import type { LiveCase } from "./live-case.ts";
import {
  assertPageReadOnly,
  openFilterControls,
  readPanelPosts,
} from "./panel-posts.ts";

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
    const entry = target.url;
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
          await clearSiteConditions(session, target.site);
          await page.bringToFront();
          session.loadGuard.setContext(target.id, "navigate");
          if (!reused)
            await page.goto(target.url, { waitUntil: "domcontentloaded" });
          else if (page.url() !== target.url)
            await page.goto(target.url, { waitUntil: "domcontentloaded" });
          await assertLivePage(session, page);
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
          await openFilterControls(panel);
          const unfilteredPosts = await readPanelPosts(panel);
          const input = `[data-minimum-group] >>> ${aria("spinbutton", "最低いいね数")}`;
          await expect.poll(() => visible(panel, input)).toBe(true);
          await expect
            .poll(() =>
              panel.$eval(input, (node) => (node as HTMLInputElement).value),
            )
            .toBe("");
          // Siftの集計値ではなく、サイト自身のいいね表示から部分除外する値を選ぶ。
          const readCounts = async () => {
            const labels = await page.$$eval(
              target.site === "x"
                ? 'article[data-testid="tweet"]'
                : '[data-testid^="feedItem-by-"]',
              (cards, metric) =>
                cards.flatMap((card) => {
                  const node = card.querySelector(metric);
                  return node
                    ? [
                        node.getAttribute("aria-label") ||
                          node.textContent ||
                          "",
                      ]
                    : [];
                }),
              target.site === "x"
                ? '[data-testid="like"], [data-testid="unlike"]'
                : '[data-testid="likeBtn"]',
            );
            return labels.map(parseMetric).filter(Number.isFinite);
          };
          const selectThreshold = (counts: number[]) =>
            selectPartialChoice(
              [...new Set(counts)].map((minimum, index) => ({
                index: index + 1,
                minimum,
                count: counts.filter((count) => count >= minimum).length,
              })),
              counts.length,
            );
          await expect
            .poll(async () => Boolean(selectThreshold(await readCounts())), {
              message: "遷移前に投稿を除外できる条件が必要です",
            })
            .toBe(true);
          const counts = await readCounts();
          const choice = selectThreshold(counts);
          if (!choice) throw Error("部分除外する最低値を選べません");
          await completeInitialLoad(session, page, task, "ready");
          await fillNumber(panel, input, choice.minimum);
          await evidence(task, "lifecycle-minimum", {
            body: JSON.stringify({
              threshold: choice.minimum,
              sampleCount: counts.length,
              retained: choice.count,
            }),
            contentType: "application/json",
          });
          await expect
            .poll(async () => {
              const posts = await readPanelPosts(panel);
              return posts.length > 0 && posts.length < unfilteredPosts.length;
            })
            .toBe(true);
          await assertPageReadOnly(page);
          const readConditions = () =>
            session.api.evaluate(
              `(async () => (await chrome.storage.sync.get('settings')).settings.siteSettings[${JSON.stringify(target.site)}])()`,
            );
          await expect
            .poll(readConditions)
            .toMatchObject({ minReactionsEnabled: true });
          const savedConditions =
            (await readConditions()) as ReactionSiteSettings;
          const closedWidth = await page.evaluate(() => innerWidth);
          const assertAutomaticClose = await observeAutomaticPanelClose(
            session,
            page,
          );
          if (target.site === "bluesky")
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
          await assertPageReadOnly(page);
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
          if (target.site === "bluesky")
            await page.locator(aria("tab", "投稿")).click();
          else await page.goBack({ waitUntil: "domcontentloaded" });
          // 一覧へ戻っても明示アクションまではパネルは閉じたまま。
          await expect
            .poll(async () => (await readContext(session, page)).pageKey)
            .toBe(originalPageKey);
          await expect
            .poll(
              async () => (await readContext(session, page)).timelineAvailable,
            )
            .toBe(true);
          await assertPageReadOnly(page);
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
          await openFilterControls(panel);
          await expect
            .poll(() =>
              panel.$eval(
                "[data-minimum-group]",
                (node, expected) => {
                  const input = node.querySelector<HTMLInputElement>(
                    'input[type="number"]',
                  );
                  return input?.value === String(expected);
                },
                savedConditions.minReactions,
              ),
            )
            .toBe(true);
          await expect.poll(readConditions).toEqual(savedConditions);
          await evidence(task, "lifecycle", {
            body: JSON.stringify({
              stages: [
                "filtered",
                "navigation-closed-cleared",
                "returned-inactive",
                "reopened-conditions-restored",
              ],
            }),
            contentType: "application/json",
          });
          healthy = true;
        } catch (error) {
          await rethrowWithDiagnostics(
            error,
            {
              "failure-native-page": () =>
                page.evaluate(() => ({
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
                  dialogs: [
                    ...document.querySelectorAll('[role="dialog"]'),
                  ].map((node) => ({
                    visible: node.checkVisibility({ visibilityProperty: true }),
                    label: node.getAttribute("aria-label"),
                  })),
                  timestampLinks: [
                    ...document.querySelectorAll(
                      'article[data-testid="tweet"] a:has(time)',
                    ),
                  ].map((node) => ({
                    href: node.getAttribute("href"),
                    visible: node.checkVisibility({ visibilityProperty: true }),
                  })),
                })),
            },
            (name, data) =>
              evidence(task, name, {
                body: JSON.stringify(data),
                contentType: "application/json",
              }),
          );
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
