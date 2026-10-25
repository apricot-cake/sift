import { expect } from "vitest";
import { aria, evidence } from "./browser-queries.ts";
import { cases, compatibilityEntry, emptyCases } from "./cases.ts";
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
import { changeXSearch } from "./x-navigation.ts";

// 実サイトが空と明示する一覧を使う。投稿が読み込まれないだけでは合格にしない。
export function createEmptyCases(): LiveCase[] {
  const entries: LiveCase[] = [];
  const entry =
    "https://x.com/search?q=from%3ANASA%20sift_empty_7d649d20&f=live";
  const search = cases.find((target) => target.id === "x-search");
  const sharedEntry = search ? compatibilityEntry(search) : entry;
  for (const target of emptyCases) {
    entries.push({
      id: target.id,
      entry: sharedEntry,
      run: async (session, task) => {
        const { page, reused } = await acquireCasePage(session, sharedEntry);
        let healthy = false;
        let cleanupError: unknown;
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(30000);
        try {
          await page.bringToFront();
          if (!reused) {
            await page.goto(entry, {
              waitUntil: "domcontentloaded",
            });
          } else await changeXSearch(page, entry);
          await assertLivePage(session, page);
          {
            const latest = aria("tab", "最新");
            await page.locator(latest).wait();
            if (
              (await page.$eval(latest, (node) =>
                node.getAttribute("aria-selected"),
              )) !== "true"
            )
              await page.locator(latest).click();
            await expect
              .poll(() =>
                page.$eval(
                  latest,
                  (node, name) => node.getAttribute(name),
                  "aria-selected",
                ),
              )
              .toBe("true");
          }
          const empty =
            '[data-testid="primaryColumn"] [data-testid="emptyState"]';
          await expect
            .poll(async () => {
              await assertLivePage(session, page);
              return page.$eval(empty, (node) =>
                (node.textContent ?? "").trim(),
              );
            })
            .toMatch(/検索結果はありません|No results/i);
          await expect
            .poll(() =>
              page.$$eval(
                'article[data-testid="tweet"]',
                (nodes) => nodes.length,
              ),
            )
            .toBe(0);
          const panel = await openPanel(session, page);
          await expect
            .poll(async () => (await readContext(session, page)).health?.state)
            .toBe("empty");
          await expect
            .poll(() =>
              panel.$eval('[data-page-health="empty"]', (node) =>
                (node.textContent ?? "").trim(),
              ),
            )
            .toBe("この一覧には投稿がありません");
          await expect
            .poll(() => panel.$$eval(aria("combobox"), (nodes) => nodes.length))
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
          await evidence(task, "empty-state", {
            body: JSON.stringify({
              state: "empty",
              siteEmpty: true,
              controls: 0,
              hidden: 0,
              panelPosts: 0,
            }),
            contentType: "application/json",
          });
          await completeInitialLoad(session, page, task, "empty");
          healthy = true;
        } finally {
          try {
            if (session.panelTargetId) await closePanel(session, page);
          } catch (error) {
            healthy = false;
            cleanupError = error;
          } finally {
            await releaseCasePage(session, sharedEntry, healthy);
          }
        }
        if (cleanupError) throw cleanupError;
      },
    });
  }
  return entries;
}
