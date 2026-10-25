import type { JSHandle, Page } from "puppeteer-core";
import { expect } from "vitest";
import { rethrowWithDiagnostics } from "../scripts/compatibility/failure-diagnostics.ts";
import { selectPartialChoice } from "../scripts/compatibility/filter-choice.ts";
import { parseMetric } from "../utils/filter-core.ts";
import {
  aria,
  element,
  evidence,
  fillNumber,
  text,
  visible,
} from "./browser-queries.ts";
import { lifecycleCases } from "./cases.ts";
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
            .poll(async () => (await readCounts())[0])
            .toBeGreaterThan(0);
          if (target.site !== "x") {
            await expect
              .poll(async () => partialIndex(await readCounts()), {
                message: "遷移前に投稿を除外できる条件が必要です",
              })
              .toBeGreaterThan(0);
          }
          const counts = await readCounts();
          await completeInitialLoad(session, page, task, "ready");
          const index = partialIndex(counts);
          await evidence(task, "lifecycle-filter-counts", {
            body: JSON.stringify({ counts, index }),
            contentType: "application/json",
          });
          if (index > 0) await (await element(panel, options, index)).click();
          else {
            expect(
              target.site,
              "数値入力への切り替えはXの最低いいね数だけに使う",
            ).toBe("x");
            // 既定候補の間に実投稿の指標が集まる場合も、一部を除外する条件を使う。
            // Siftの集計値ではなく、サイト自身のいいね表示から数値を選ぶ。
            const labels = await page.$$eval(
              'article[data-testid="tweet"]',
              (cards) =>
                cards.map(
                  (card) =>
                    card
                      .querySelector(
                        '[data-testid="like"], [data-testid="unlike"]',
                      )
                      ?.getAttribute("aria-label") ?? "",
                ),
            );
            const values = [
              ...new Set(
                labels
                  .filter((label) => /^\d/.test(label))
                  .map(parseMetric)
                  .filter(Number.isFinite),
              ),
            ].sort((a, b) => a - b);
            expect(
              values.length,
              "部分除外の検証に必要な異なるいいね数がありません",
            ).toBeGreaterThan(1);
            const threshold = values[Math.floor(values.length / 2)];
            if (threshold === undefined) throw Error("除外条件を選べません");
            await (
              await element(panel, `${options} >>> ${text("数値を入力")}`)
            ).click();
            await fillNumber(
              panel,
              aria("spinbutton", "数値を入力"),
              threshold,
            );
            await evidence(task, "lifecycle-custom-minimum", {
              body: JSON.stringify({
                threshold,
                sampleCount: labels.length,
                distinctCounts: values.length,
              }),
              contentType: "application/json",
            });
          }
          await expect
            .poll(async () => {
              const posts = await readPanelPosts(panel);
              return posts.length > 0 && posts.length < unfilteredPosts.length;
            })
            .toBe(true);
          await assertPageReadOnly(page);
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
