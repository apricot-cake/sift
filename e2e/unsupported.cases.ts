import { expect } from "vitest";
import { rethrowWithDiagnostics } from "../scripts/compatibility/failure-diagnostics.ts";
import { aria, evidence, text, visible } from "./browser-queries.ts";
import { unsupportedCases, unsupportedEntry } from "./cases.ts";
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
  assertPanelScrollAnchor,
  narrowPanelWindow,
  readPanelScrollAnchor,
  scrollToPanelAnchor,
} from "./panel-scroll.ts";
import { changeXSearch } from "./x-navigation.ts";
export function createUnsupportedCases(): LiveCase[] {
  const entries: LiveCase[] = [];
  for (const target of unsupportedCases) {
    entries.push({
      id: target.id,
      entry: unsupportedEntry(target),
      run: async (session, task) => {
        const entry = unsupportedEntry(target);
        const { page, reused } = await acquireCasePage(session, entry);
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(30000);
        let healthy = false;
        let cleanupError: unknown;
        let restoreWindow: (() => Promise<void>) | undefined;
        let scrollAnchor: { id: string; top: number } | undefined;
        try {
          await page.bringToFront();
          const navigationUrl = new URL(target.url);
          const response = reused
            ? null
            : await page.goto(navigationUrl.href, {
                waitUntil: "domcontentloaded",
              });
          await assertLivePage(session, page);
          if (
            reused &&
            target.site === "x" &&
            navigationUrl.pathname === "/search"
          )
            await changeXSearch(page, navigationUrl.href);
          await evidence(task, "http-response", {
            body: JSON.stringify({
              url: response?.url() ?? page.url(),
              status: response?.status() ?? null,
              ok: response?.ok() ?? null,
              reused,
              firstNavigation: !reused,
            }),
            contentType: "application/json",
          });
          // gotoは実文書を開いてもHTTPResponseを返さないことがある。
          // 応答が無い場合のHTTP状態はnullのまま残し、後続のサイトUIで成立を確認する。
          if (!reused && response)
            expect(
              response.ok() || response.status() === 304,
              "対象ページのHTTP応答が成功またはキャッシュ再検証済みであること",
            ).toBe(true);
          if ("profileMedia" in target) {
            const media = 'a[role="tab"][href="/NASA/media"]';
            await page.locator(media).wait();
            await page.$eval(media, (node) =>
              (node as HTMLAnchorElement).focus(),
            );
            await expect
              .poll(() =>
                page.$eval(media, (node) => node === document.activeElement),
              )
              .toBe(true);
            await page.keyboard.press("Enter");
            await expect
              .poll(() => page.url())
              .toBe("https://x.com/NASA/media");
            await expect
              .poll(() =>
                page.$eval(
                  'a[role="tab"][href="/NASA/media"]',
                  (node, name) => node.getAttribute(name),
                  "aria-selected",
                ),
              )
              .toBe("true");
          }
          if (target.id === "unsupported-x-images") {
            const media = 'a[role="tab"][href="/NASA/media"]';
            // 共有ページが返信タブでも、サイト自身の操作でメディアへ移動する。
            // 単独実行の /media 文書はそのまま使い、選択済みタブで画像メニューを開く。
            if (new URL(page.url()).pathname !== "/NASA/media") {
              await page.locator(media).wait();
              await page.$eval(media, (node) =>
                (node as HTMLAnchorElement).focus(),
              );
              await expect
                .poll(() =>
                  page.$eval(media, (node) => node === document.activeElement),
                )
                .toBe(true);
              await page.keyboard.press("Enter");
            }
            await expect
              .poll(() => page.url())
              .toBe("https://x.com/NASA/media");
            await expect
              .poll(() =>
                page.$eval(media, (node) => node.getAttribute("aria-selected")),
              )
              .toBe("true");
            await evidence(task, "native-media-tab", {
              body: JSON.stringify({ url: page.url(), reused, selected: true }),
              contentType: "application/json",
            });
            await page.locator(media).click();
            await page.locator(aria("menuitem", "画像")).click();
            await expect
              .poll(() => page.url())
              .toBe("https://x.com/NASA/media?filter=photo");
            await expect
              .poll(() =>
                page.$eval(
                  'a[role="tab"][href="/NASA/media?filter=photo"]',
                  (node, name) => node.getAttribute(name),
                  "aria-selected",
                ),
              )
              .toBe("true");
            await expect
              .poll(() =>
                visible(
                  page,
                  '[data-testid="primaryColumn"] a[href*="/photo/"]',
                ),
              )
              .toBe(true);
            await expect
              .poll(() =>
                page.$$eval(
                  'article[data-testid="tweet"]',
                  (nodes) => nodes.length,
                ),
              )
              .toBe(0);
          }
          if ("label" in target && target.label) {
            const tab = aria("tab", target.label);
            if (target.id === "unsupported-x-replies") {
              const destination = `${new URL(target.url).pathname}/with_replies`;
              const anchor = `a[role="tab"][href=${JSON.stringify(destination)}]`;
              await page.locator(anchor).wait();
              await page.$eval(anchor, (node) =>
                (node as HTMLAnchorElement).focus(),
              );
              await expect
                .poll(() =>
                  page.$eval(anchor, (node) => node === document.activeElement),
                )
                .toBe(true);
              await page.keyboard.press("Enter");
              await expect
                .poll(() => new URL(page.url()).pathname)
                .toBe(destination);
              await expect
                .poll(() =>
                  page.$eval(anchor, (node) =>
                    node.getAttribute("aria-selected"),
                  ),
                )
                .toBe("true");
            } else {
              await page.locator(tab).wait();
              const selected =
                target.site === "bluesky" &&
                (await page.$eval(tab, (node) => {
                  const mark = node.querySelector(
                    '[style*="background-color"]',
                  );
                  return (
                    !!mark &&
                    getComputedStyle(mark).display !== "none" &&
                    mark.getBoundingClientRect().height > 0
                  );
                }));
              if (!selected) await page.locator(tab).click();
            }
            if (target.site === "bluesky")
              await expect
                .poll(() =>
                  visible(page, `${tab} >>> [style*="background-color"]`),
                )
                .toBe(true);
            else
              await expect
                .poll(() =>
                  page.$eval(
                    tab,
                    (node, name) => node.getAttribute(name),
                    "aria-selected",
                  ),
                )
                .toBe("true");
          }
          if (target.id === "unsupported-site") {
            await expect.poll(() => page.url()).toBe(target.url);
            await expect.poll(() => page.title()).toBe("Example Domain");
          }
          if (target.id === "unsupported-fanbox") {
            await expect
              .poll(() => visible(page, 'a[href^="/posts/"]'))
              .toBe(true);
            await evidence(task, "unsupported-page", {
              body: JSON.stringify({
                url: page.url(),
                title: await page.title(),
                postLinks: await page.$$eval('a[href^="/posts/"]', (nodes) =>
                  nodes.map((node) => node.getAttribute("href")),
                ),
              }),
              contentType: "application/json",
            });
          }
          if (target.site === "x") {
            await expect
              .poll(() => visible(page, '[data-testid="primaryColumn"]'))
              .toBe(true);
            await evidence(task, "native-page", {
              body: JSON.stringify(
                await page.evaluate(() => ({
                  url: location.href,
                  title: document.title,
                  readyState: document.readyState,
                  selectedTabs: [
                    ...document.querySelectorAll(
                      '[role="tab"][aria-selected="true"]',
                    ),
                  ].map((node) => node.textContent?.trim()),
                })),
              ),
              contentType: "application/json",
            });
          }
          {
            await assertLivePage(session, page);
            if (target.id === "unsupported-x-recommended") {
              await expect
                .poll(
                  () =>
                    page.$$eval(
                      'article[data-testid="tweet"]',
                      (nodes) => nodes.length,
                    ),
                  { timeout: 30000 },
                )
                .toBeGreaterThan(0);
              // 初回権限取得に伴う準備開閉を、位置を記録する前に済ませる。
              await openPanel(session, page);
              await closePanel(session, page);
              restoreWindow = await narrowPanelWindow(page);
              scrollAnchor = await scrollToPanelAnchor(page);
              await evidence(task, "panel-scroll-before", {
                body: JSON.stringify({
                  anchor: scrollAnchor,
                  viewport: await page.evaluate(() => ({
                    width: innerWidth,
                    scrollY,
                  })),
                }),
                contentType: "application/json",
              });
            }
            const panel = await openPanel(session, page);
            if (scrollAnchor) {
              await assertPanelScrollAnchor(page, scrollAnchor);
              await evidence(task, "panel-scroll-after", {
                body: JSON.stringify({
                  before: scrollAnchor,
                  after: await readPanelScrollAnchor(page, scrollAnchor.id),
                  viewport: await page.evaluate(() => ({
                    width: innerWidth,
                    scrollY,
                  })),
                  tolerance: 2,
                }),
                contentType: "application/json",
              });
            }
            await expect
              .poll(() =>
                visible(
                  panel,
                  text(
                    target.site === "none"
                      ? "このページではフィルターを使えません"
                      : "このページはフィルター対象外です",
                  ),
                ),
              )
              .toBe(true);
            if (target.id === "unsupported-x-images")
              await expect
                .poll(() => visible(panel, text("プロフィールの「ポスト」")))
                .toBe(true);
            await expect
              .poll(() =>
                panel.$$eval(aria("combobox"), (nodes) => nodes.length),
              )
              .toBe(0);
            await expect
              .poll(() => panel.$$eval(aria("switch"), (nodes) => nodes.length))
              .toBe(0);
            expect(
              await panel.$$eval("a[data-post-link]", (nodes) => nodes.length),
            ).toBe(0);
            await expect
              .poll(() =>
                page.$$eval(
                  '[data-sift-filter-state="hidden"]',
                  (nodes) => nodes.length,
                ),
              )
              .toBe(0);
            if (target.site === "none") {
              // 対応外サイトにはcontent scriptの受信先自体が存在しない。
              await expect(readContext(session, page)).rejects.toThrow(
                /Receiving end does not exist/,
              );
            } else {
              await expect
                .poll(
                  async () =>
                    (await readContext(session, page)).timelineAvailable,
                )
                .toBe(false);
            }
            await completeInitialLoad(session, page, task, "unsupported");
            await evidence(task, "unsupported-state", {
              body: JSON.stringify({
                state: "unsupported",
                controls: 0,
                hidden: 0,
                panelPosts: 0,
                timelineAvailable: false,
              }),
              contentType: "application/json",
            });
          }
          healthy = true;
        } catch (error) {
          await rethrowWithDiagnostics(
            error,
            {
              "failure-page": () =>
                page.evaluate(() => ({
                  url: location.href,
                  title: document.title,
                  readyState: document.readyState,
                  scrollY,
                  width: innerWidth,
                  activeHref: document.activeElement?.getAttribute("href"),
                  selectedTabs: [
                    ...document.querySelectorAll('a[role="tab"]'),
                  ].map((node) => ({
                    href: node.getAttribute("href"),
                    selected: node.getAttribute("aria-selected"),
                  })),
                  dialogs: [
                    ...document.querySelectorAll('[role="dialog"]'),
                  ].map((node) => ({
                    visible: node.checkVisibility({ visibilityProperty: true }),
                    label: node.getAttribute("aria-label"),
                  })),
                })),
              ...(scrollAnchor
                ? {
                    "failure-panel-scroll": async () => ({
                      before: scrollAnchor,
                      after: await readPanelScrollAnchor(
                        page,
                        scrollAnchor?.id,
                      ),
                    }),
                  }
                : {}),
            },
            (name, data) =>
              evidence(task, name, {
                body: JSON.stringify(data),
                contentType: "application/json",
              }),
          );
        } finally {
          try {
            if (session.panelTargetId) await closePanel(session, page);
          } catch (error) {
            healthy = false;
            cleanupError = error;
          } finally {
            try {
              await restoreWindow?.();
            } catch (error) {
              healthy = false;
              cleanupError ??= error;
            } finally {
              await releaseCasePage(session, entry, healthy);
            }
          }
        }
        if (cleanupError) throw cleanupError;
      },
    });
  }
  return entries;
}
