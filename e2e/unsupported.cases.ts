import { expect } from "vitest";
import { aria, evidence, text, visible } from "./browser-queries.ts";
import {
  directInitializationCaseIds,
  unsupportedCases,
  unsupportedEntry,
} from "./cases.ts";
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
  selectNiconicoSearchSort,
  selectNiconicoUserSort,
} from "./niconico-navigation.ts";
import { changeXSearch } from "./x-navigation.ts";
import { changeYoutubeChannelSearch } from "./youtube-navigation.ts";

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
        try {
          await page.bringToFront();
          const navigationUrl = new URL(target.url);
          if (target.channelSearch) {
            navigationUrl.pathname = navigationUrl.pathname.replace(
              /\/videos$/,
              "/search",
            );
            navigationUrl.searchParams.set("query", target.channelSearch);
          }
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
          if (
            reused &&
            target.site === "youtube" &&
            (target.channelSearch || target.empty)
          )
            await changeYoutubeChannelSearch(page, navigationUrl.href);
          if (
            target.site === "niconico" &&
            navigationUrl.pathname.startsWith("/search/")
          )
            await evidence(task, "native-search-sort", {
              body: JSON.stringify(
                await selectNiconicoSearchSort(page, navigationUrl.href),
              ),
              contentType: "application/json",
            });
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
          // 同じチャンネルを再利用した直前のケースがライブやShortsでも、
          // /videos を入口とするケースはネイティブの動画タブへ戻してから検証する。
          const tabName =
            target.tab ??
            (target.site === "youtube" &&
            navigationUrl.pathname.endsWith("/videos")
              ? "動画"
              : undefined);
          if (tabName) {
            const navigation = aria(
              target.site === "niconico" ? "link" : "tab",
              tabName,
            );
            await page.locator(navigation).setTimeout(30000).wait();
            const selected =
              target.site === "youtube" &&
              (await page.$eval(
                navigation,
                (node) =>
                  node.getAttribute("aria-selected") === "true" ||
                  node.matches(".ytTabShapeTabSelected, [selected]") ||
                  !!node.querySelector(".ytTabShapeTabSelected"),
              ));
            if (!selected) await page.locator(navigation).click();
            if (target.site === "youtube") {
              const paths: Record<string, string> = {
                動画: "videos",
                ショート: "shorts",
                ライブ: "streams",
              };
              const tabPath = paths[tabName];
              if (tabPath)
                await expect
                  .poll(() => new URL(page.url()).pathname)
                  .toBe(
                    `${navigationUrl.pathname.replace(/\/(videos|shorts|streams)$/, "")}/${tabPath}`,
                  );
              const tab = aria("tab", tabName);
              await expect
                .poll(() =>
                  page.$eval(
                    tab,
                    (node) =>
                      node.getAttribute("aria-selected") === "true" ||
                      node.matches(".ytTabShapeTabSelected, [selected]") ||
                      !!node.querySelector(".ytTabShapeTabSelected"),
                  ),
                )
                .toBe(true);
              await page.waitForNetworkIdle({
                idleTime: 500,
                concurrency: 2,
                timeout: 10000,
              });
              await evidence(task, "native-channel-tab", {
                body: JSON.stringify({
                  url: page.url(),
                  tab: tabName,
                  selected: await page.$eval(
                    tab,
                    (node) =>
                      node.getAttribute("aria-selected") === "true" ||
                      node.matches(".ytTabShapeTabSelected, [selected]") ||
                      !!node.querySelector(".ytTabShapeTabSelected"),
                  ),
                }),
                contentType: "application/json",
              });
            }
          }
          if (target.sort === "newest" || target.sort === "popular") {
            const names =
              target.sort === "popular"
                ? ["人気の動画", "Popular", "Most popular"]
                : ["新しい順", "Latest", "Newest"];
            const combo = 'ytd-browse:not([hidden]) [role="combobox"]';
            await expect
              .poll(() => visible(page, `${combo}, ${aria("tab", names)}`))
              .toBe(true);
            if (await page.$$eval(combo, (nodes) => nodes.length)) {
              const selected = await page.$eval(combo, (node) =>
                (node.textContent ?? "").trim(),
              );
              if (!names.includes(selected)) {
                await page.locator(combo).click();
                await page.locator(aria("menuitem", names)).click();
              }
              await expect
                .poll(() =>
                  page.$eval(combo, (node) => (node.textContent ?? "").trim()),
                )
                .toMatch(
                  target.sort === "popular"
                    ? /^(人気の動画|Popular|Most popular)$/
                    : /^(新しい順|Latest|Newest)$/,
                );
            } else {
              const sortTab = aria("tab", names);
              await page.locator(sortTab).wait();
              if (
                (await page.$eval(sortTab, (node) =>
                  node.getAttribute("aria-selected"),
                )) !== "true"
              )
                await page.locator(sortTab).click();
              await expect
                .poll(() =>
                  page.$eval(sortTab, (node) =>
                    node.getAttribute("aria-selected"),
                  ),
                )
                .toBe("true");
            }
            if (target.site === "youtube") {
              await page.waitForNetworkIdle({
                idleTime: 500,
                concurrency: 2,
                timeout: 10000,
              });
              // Shortsは対応外なので拡張機能のsortOrderではなく、サイトの選択表示を再確認する。
              await expect
                .poll(async () => {
                  if (await visible(page, combo))
                    return page.$eval(combo, (node) =>
                      (node.textContent ?? "").trim(),
                    );
                  const sortTab = aria("tab", names);
                  return page.$eval(sortTab, (node) =>
                    node.getAttribute("aria-selected") === "true"
                      ? (node.textContent ?? "").trim()
                      : "",
                  );
                })
                .toMatch(
                  target.sort === "popular"
                    ? /^(人気の動画|Popular|Most popular)$/
                    : /^(新しい順|Latest|Newest)$/,
                );
            }
          }
          if (target.membersOnly)
            await page.locator(aria("tab", "メンバー限定")).click();
          if (target.channelSearch) {
            await expect
              .poll(() => new URL(page.url()).pathname)
              .toBe(navigationUrl.pathname);
            await expect
              .poll(() => new URL(page.url()).searchParams.get("query"))
              .toBe(target.channelSearch);
            const cards = "ytd-browse:not([hidden]) ytd-video-renderer";
            await page.locator(cards).wait();
            await evidence(task, "channel-search-page", {
              body: JSON.stringify({
                url: page.url(),
                videoCards: await page.$$eval(cards, (nodes) => nodes.length),
              }),
              contentType: "application/json",
            });
          }
          if (target.empty)
            await expect
              .poll(() =>
                page.$eval(
                  "ytd-browse:not([hidden]) ytd-message-renderer",
                  (node) => node.textContent,
                ),
              )
              .toMatch(/一致するコンテンツはありません/);
          if ("profileMedia" in target) {
            const media = 'a[role="tab"][href="/AdamasMC/media"]';
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
              .toBe("https://x.com/AdamasMC/media");
            await expect
              .poll(() =>
                page.$eval(
                  'a[role="tab"][href="/AdamasMC/media"]',
                  (node, name) => node.getAttribute(name),
                  "aria-selected",
                ),
              )
              .toBe("true");
          }
          if (target.id === "unsupported-x-images") {
            const media = 'a[role="tab"][href="/uowata94/media"]';
            // 共有ページが返信タブでも、サイト自身の操作でメディアへ移動する。
            // 単独実行の /media 文書はそのまま使い、選択済みタブで画像メニューを開く。
            if (new URL(page.url()).pathname !== "/uowata94/media") {
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
              .toBe("https://x.com/uowata94/media");
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
              .toBe("https://x.com/uowata94/media?filter=photo");
            await expect
              .poll(() =>
                page.$eval(
                  'a[role="tab"][href="/uowata94/media?filter=photo"]',
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
          if (target.id.startsWith("unsupported-youtube-oldest")) {
            const combo = 'ytd-browse:not([hidden]) [role="combobox"]';
            const oldest = aria("tab", ["古い順", "Oldest"]);
            await expect
              .poll(() => visible(page, `${combo}, ${oldest}`))
              .toBe(true);
            const dropdown = target.id.endsWith("dropdown");
            expect(
              (await page.$$eval(combo, (nodes) => nodes.length)) > 0,
              "指定した表示形式が実際に存在すること",
            ).toBe(dropdown);
            if (dropdown) {
              if (
                !/^(古い順|Oldest)$/.test(
                  await page.$eval(combo, (node) =>
                    (node.textContent ?? "").trim(),
                  ),
                )
              ) {
                await page.locator(combo).click();
                await page
                  .locator(aria("menuitem", ["古い順", "Oldest"]))
                  .click();
              }
              await expect
                .poll(() =>
                  page.$eval(combo, (node) => (node.textContent ?? "").trim()),
                )
                .toMatch(/^(古い順|Oldest)$/);
            } else {
              await page.locator(oldest).wait();
              if (
                (await page.$eval(oldest, (node) =>
                  node.getAttribute("aria-selected"),
                )) !== "true"
              )
                await page.locator(oldest).click();
              await expect
                .poll(() =>
                  page.$eval(
                    oldest,
                    (node, name) => node.getAttribute(name),
                    "aria-selected",
                  ),
                )
                .toBe("true");
            }
          } else if (
            target.site === "niconico" &&
            "label" in target &&
            target.label
          ) {
            await evidence(task, "native-user-sort", {
              body: JSON.stringify(
                await selectNiconicoUserSort(page, target.label),
              ),
              contentType: "application/json",
            });
          } else if ("label" in target && target.label) {
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
          if (target.id === "unsupported-site")
            await expect
              .poll(() =>
                visible(
                  page,
                  `${aria("banner")} >>> ${aria("link", "@apricot-cake")}`,
                ),
              )
              .toBe(true);
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
          const directInitialization = directInitializationCaseIds.some(
            (id) => id === target.id,
          );
          const directUrl = page.url();
          const stages = directInitialization ? ["spa", "direct"] : ["normal"];
          for (const stage of stages) {
            if (stage === "direct") {
              // ネイティブ操作で成立した状態と同じURLを直接開く。読み込み後に
              // 並び順や検索語を操作して、初期化の誤りを隠さない。
              const requestedUrl = directUrl;
              session.loadGuard.setContext(target.id, "direct-initialization");
              const directResponse = await page.goto(requestedUrl, {
                waitUntil: "domcontentloaded",
              });
              await assertLivePage(session, page);
              await evidence(task, "direct-initialization", {
                body: JSON.stringify({
                  requestedUrl,
                  url: page.url(),
                  responseUrl: directResponse?.url() ?? null,
                  status: directResponse?.status() ?? null,
                  ok: directResponse?.ok() ?? null,
                  reused,
                  firstNavigation: false,
                  directlyLoaded: true,
                }),
                contentType: "application/json",
              });
              if (directResponse)
                expect(
                  directResponse.ok() || directResponse.status() === 304,
                ).toBe(true);
              await expect
                .poll(() => new URL(page.url()).origin)
                .toBe(navigationUrl.origin);
              await expect
                .poll(() => new URL(page.url()).pathname)
                .toBe(navigationUrl.pathname);
              if (target.site === "niconico") {
                await expect
                  .poll(
                    () =>
                      new URL(page.url()).searchParams.get("sort") ??
                      "registeredAt",
                  )
                  .toBe("registeredAt");
                await expect
                  .poll(
                    () =>
                      new URL(page.url()).searchParams.get("order") ?? "desc",
                  )
                  .toBe("asc");
                await expect
                  .poll(() => new URL(page.url()).searchParams.get("page"))
                  .toBeNull();
                await expect
                  .poll(() =>
                    page.$eval(aria("combobox", "ソートキーを選択"), (node) =>
                      (node.textContent ?? "").trim(),
                    ),
                  )
                  .toBe("投稿日時");
                await expect
                  .poll(() =>
                    page.$$eval("button[aria-label$='順に切り替え']", (nodes) =>
                      nodes
                        .filter((node) =>
                          node.checkVisibility({ visibilityProperty: true }),
                        )
                        .map((node) => node.getAttribute("aria-label")),
                    ),
                  )
                  .toEqual(["降順に切り替え"]);
              } else {
                await expect
                  .poll(() => new URL(page.url()).searchParams.get("query"))
                  .toBe(navigationUrl.searchParams.get("query"));
                await expect
                  .poll(() =>
                    page.$eval(
                      "ytd-browse:not([hidden]) ytd-message-renderer",
                      (node) => node.textContent,
                    ),
                  )
                  .toMatch(/一致するコンテンツはありません/);
              }
            }
            await assertLivePage(session, page);
            const panel = await openPanel(session, page);
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
            if (stage !== "direct")
              await completeInitialLoad(session, page, task, "unsupported");
            await evidence(
              task,
              stage === "spa" ? "spa-unsupported-state" : "unsupported-state",
              {
                body: JSON.stringify({
                  state: "unsupported",
                  controls: 0,
                  hidden: 0,
                  timelineAvailable: false,
                }),
                contentType: "application/json",
              },
            );
            if (stage === "spa") await closePanel(session, page);
          }
          healthy = true;
        } catch (error) {
          await evidence(task, "failure-page", {
            body: JSON.stringify(
              await page.evaluate(() => ({
                url: location.href,
                title: document.title,
                readyState: document.readyState,
                activeHref: document.activeElement?.getAttribute("href"),
                selectedTabs: [
                  ...document.querySelectorAll('a[role="tab"]'),
                ].map((node) => ({
                  href: node.getAttribute("href"),
                  selected: node.getAttribute("aria-selected"),
                })),
                youtubeTabs: [...document.querySelectorAll('[role="tab"]')].map(
                  (node) => ({
                    text: node.textContent?.trim(),
                    selected: node.getAttribute("aria-selected"),
                    selectedShape:
                      node.matches(".ytTabShapeTabSelected, [selected]") ||
                      !!node.querySelector(".ytTabShapeTabSelected"),
                  }),
                ),
                dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
                  (node) => ({
                    visible: node.checkVisibility({ visibilityProperty: true }),
                    label: node.getAttribute("aria-label"),
                  }),
                ),
                sortButtons: [
                  ...document.querySelectorAll(".Selectbox-button"),
                ].map((node) => ({
                  text: node.textContent?.trim(),
                  rect: node.getBoundingClientRect().toJSON(),
                })),
                videoCards: document.querySelectorAll(
                  "[data-decoration-video-id], [data-video-id], .NC-VideoMediaObject, main article",
                ).length,
              })),
            ),
            contentType: "application/json",
          }).catch(() => {});
          throw error;
        } finally {
          try {
            if (session.panelTargetId) await closePanel(session, page);
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
