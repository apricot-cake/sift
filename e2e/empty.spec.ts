import { expect, test } from "@playwright/test";
import { emptyCases } from "./cases.ts";
import {
  closePanel,
  connectLive,
  finishLive,
  openPanel,
  readContext,
} from "./live.ts";

// 実サイトが空と明示する一覧を使う。投稿が読み込まれないだけでは合格にしない。
// biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture arguments.
test(emptyCases[0].id, async ({}, info) => {
  const session = await connectLive();
  const page = await session.context.newPage();
  try {
    await page.bringToFront();
    await page.goto(
      "https://x.com/search?q=from%3Auowata94%20sift_empty_7d649d20&f=live",
      {
        waitUntil: "domcontentloaded",
      },
    );
    const latest = page.getByRole("tab", { name: "最新", exact: true });
    await latest.click();
    await expect(latest).toHaveAttribute("aria-selected", "true");
    const empty = page.locator(
      '[data-testid="primaryColumn"] [data-testid="emptyState"]',
    );
    await expect(empty).toContainText(/検索結果はありません|No results/i);
    await expect(page.locator('article[data-testid="tweet"]')).toHaveCount(0);
    const panel = await openPanel(session, page);
    await expect
      .poll(async () => (await readContext(session, page)).health?.state)
      .toBe("empty");
    await expect(panel.locator('[data-page-health="empty"]')).toHaveText(
      "この一覧には投稿がありません",
    );
    await expect(panel.getByRole("combobox")).toHaveCount(0);
    await expect(panel.getByRole("switch")).toHaveCount(0);
    await expect(page.locator('[data-sift-filter-state="hidden"]')).toHaveCount(
      0,
    );
    await info.attach("empty-state", {
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
      await page.close();
      await finishLive(session);
    }
  }
});
