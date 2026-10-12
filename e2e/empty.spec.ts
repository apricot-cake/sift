import { expect, test } from "vitest";
import { aria, evidence } from "./browser-queries.ts";
import { emptyCases } from "./cases.ts";
import {
  closePanel,
  connectLive,
  finishLive,
  openPanel,
  readContext,
} from "./live.ts";

// 実サイトが空と明示する一覧を使う。投稿が読み込まれないだけでは合格にしない。
for (const target of emptyCases) {
  test(target.id, async ({ task }) => {
    const session = await connectLive();
    const page = await session.context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(30000);
    try {
      await page.bringToFront();
      await page.goto(
        "https://x.com/search?q=from%3Auowata94%20sift_empty_7d649d20&f=live",
        {
          waitUntil: "domcontentloaded",
        },
      );
      {
        const latest = aria("tab", "最新");
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
      const empty = '[data-testid="primaryColumn"] [data-testid="emptyState"]';
      await expect
        .poll(() =>
          page.$eval(empty, (node) => (node.textContent ?? "").trim()),
        )
        .toMatch(/検索結果はありません|No results/i);
      await expect
        .poll(() =>
          page.$$eval('article[data-testid="tweet"]', (nodes) => nodes.length),
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
        }),
        contentType: "application/json",
      });
    } finally {
      try {
        if (session.panelTargetId) await closePanel(session, page);
      } finally {
        try {
          await page.close();
        } finally {
          await finishLive(session);
        }
      }
    }
  });
}
