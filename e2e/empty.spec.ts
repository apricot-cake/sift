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
for (const target of emptyCases) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture arguments.
  test(target.id, async ({}, info) => {
    const youtube = target.id === "empty-youtube-channel-search";
    const session = await connectLive();
    const page = await session.context.newPage();
    try {
      await page.bringToFront();
      await page.goto(
        youtube
          ? "https://www.youtube.com/@zunda_drop/search?query=sift_empty_7d649d20"
          : "https://x.com/search?q=from%3Auowata94%20sift_empty_7d649d20&f=live",
        {
          waitUntil: "domcontentloaded",
        },
      );
      if (!youtube) {
        const latest = page.getByRole("tab", { name: "最新", exact: true });
        await latest.click();
        await expect(latest).toHaveAttribute("aria-selected", "true");
      }
      const empty = page.locator(
        youtube
          ? "ytd-browse:not([hidden]) ytd-message-renderer"
          : '[data-testid="primaryColumn"] [data-testid="emptyState"]',
      );
      await expect(empty).toContainText(
        youtube
          ? /一致するコンテンツはありません/
          : /検索結果はありません|No results/i,
      );
      await expect(
        page.locator(
          youtube ? "ytd-video-renderer" : 'article[data-testid="tweet"]',
        ),
      ).toHaveCount(0);
      const panel = await openPanel(session, page);
      await expect
        .poll(async () => (await readContext(session, page)).health?.state)
        .toBe("empty");
      await expect(panel.locator('[data-page-health="empty"]')).toHaveText(
        "この一覧には投稿がありません",
      );
      await expect(panel.getByRole("combobox")).toHaveCount(0);
      await expect(panel.getByRole("switch")).toHaveCount(0);
      await expect(
        page.locator('[data-sift-filter-state="hidden"]'),
      ).toHaveCount(0);
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
}
