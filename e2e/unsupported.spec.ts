import { afterAll, beforeAll, expect, test } from "vitest";
import { aria, evidence, text, visible } from "./browser-queries.ts";
import { unsupportedCases } from "./cases.ts";
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

for (const target of unsupportedCases) {
  test(target.id, async ({ task }) => {
    const page = await session.context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(30000);
    try {
      await page.setCacheEnabled(false);
      await page.bringToFront();
      const navigationUrl = new URL(target.url);
      if (target.channelSearch) {
        navigationUrl.pathname = navigationUrl.pathname.replace(
          /\/videos$/,
          "/search",
        );
        navigationUrl.searchParams.set("query", target.channelSearch);
      }
      const response = await page.goto(navigationUrl.href, {
        waitUntil: "domcontentloaded",
      });
      await evidence(task, "http-response", {
        body: JSON.stringify({
          url: response?.url() ?? page.url(),
          status: response?.status() ?? null,
          ok: response?.ok() ?? false,
        }),
        contentType: "application/json",
      });
      expect(response?.ok(), "対象ページのHTTP応答が正常であること").toBe(true);
      if (target.tab)
        await page
          .locator(
            aria(target.site === "niconico" ? "link" : "tab", target.tab),
          )
          .setTimeout(30000)
          .click();
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
          await page.locator(combo).click();
          await page.locator(aria("menuitem", names)).click();
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
          await page.locator(sortTab).click();
          await expect
            .poll(() =>
              page.$eval(sortTab, (node) => node.getAttribute("aria-selected")),
            )
            .toBe("true");
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
        await page.locator('a[role="tab"][href="/AdamasMC/media"]').click();
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
        await page.locator('a[role="tab"][href="/uowata94/media"]').click();
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
            visible(page, '[data-testid="primaryColumn"] a[href*="/photo/"]'),
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
          await page.locator(combo).click();
          await page.locator(aria("menuitem", ["古い順", "Oldest"])).click();
          await expect
            .poll(() =>
              page.$eval(combo, (node) => (node.textContent ?? "").trim()),
            )
            .toMatch(/^(古い順|Oldest)$/);
        } else {
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
        // 投稿一覧が表示されてから、サイトの並び順メニューを操作する。
        await page
          .locator(
            "[data-decoration-video-id], [data-video-id], .NC-VideoMediaObject, main article",
          )
          .wait();
        await page.locator(".Selectbox-button").click();
        await page.locator(text(target.label)).click();
        await expect
          .poll(() =>
            page.$eval(".Selectbox-button", (node) =>
              (node.textContent ?? "").trim(),
            ),
          )
          .toBe(target.label);
      } else if ("label" in target && target.label) {
        const tab = aria("tab", target.label);
        await page.locator(tab).click();
        if (target.site === "bluesky")
          await expect
            .poll(() => visible(page, `${tab} >>> [style*="background-color"]`))
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
        await expect.poll(() => visible(page, 'a[href^="/posts/"]')).toBe(true);
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
        .poll(() => panel.$$eval(aria("combobox"), (nodes) => nodes.length))
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
            async () => (await readContext(session, page)).timelineAvailable,
          )
          .toBe(false);
      }
      await evidence(task, "unsupported-state", {
        body: JSON.stringify({
          state: "unsupported",
          controls: 0,
          hidden: 0,
          timelineAvailable: false,
        }),
        contentType: "application/json",
      });
    } catch (error) {
      await evidence(task, "failure-page", {
        body: JSON.stringify(
          await page.evaluate(() => ({
            url: location.href,
            title: document.title,
            readyState: document.readyState,
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
      } finally {
        await page.close();
      }
    }
  });
}
