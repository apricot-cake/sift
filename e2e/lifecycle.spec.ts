import { expect, type Page, test } from "@playwright/test";
import { lifecycleCases } from "./cases.ts";
import {
  closePanel,
  connectLive,
  finishLive,
  type LiveSession,
  openPanel,
  readContext,
} from "./live.ts";

let session: LiveSession;
test.beforeAll(async () => {
  session = await connectLive();
});
test.afterAll(async () => {
  if (session) await finishLive(session);
});

async function chooseNico(page: Page, label: string) {
  await page.locator(".Selectbox-button").click();
  await page.getByText(label, { exact: true }).click();
}

for (const target of lifecycleCases) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture arguments.
  test(target.id, async ({}, info) => {
    const page = await session.context.newPage();
    let opened = false;
    try {
      await page.bringToFront();
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      if (target.site === "bluesky")
        await page.getByRole("tab", { name: "投稿", exact: true }).click();
      await expect(
        page
          .locator(
            {
              youtube: "ytd-rich-item-renderer",
              niconico: ".NC-VideoMediaObject",
              x: 'article[data-testid="tweet"]',
              bluesky: '[data-testid^="feedItem-by-"]',
            }[target.site],
          )
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      let panel = await openPanel(session, page);
      opened = true;
      await expect
        .poll(async () => (await readContext(session, page)).health?.state)
        .toBe("ready");
      const picker = panel
        .locator("[data-minimum-picker]")
        .getByRole("combobox");
      await expect(picker).toBeVisible();
      await picker.click({ force: true });
      const options = panel.getByRole("option");
      await expect(options.first()).toBeVisible();
      const counts = await options.evaluateAll((nodes) =>
        nodes.map((node) =>
          Number(
            node
              .querySelector("[data-choice-count]")
              ?.textContent?.replace(/[^\d]/g, ""),
          ),
        ),
      );
      const index = counts.findIndex(
        (count, i) => i > 0 && count > 0 && count < (counts[0] ?? 0),
      );
      expect(index, "遷移前に適用できる最低値が必要です").toBeGreaterThan(0);
      await options.nth(index).click({ force: true });
      await expect
        .poll(() => page.locator('[data-sift-filter-state="hidden"]').count())
        .toBeGreaterThan(0);

      if (target.site === "youtube")
        await page.getByRole("tab", { name: "ホーム", exact: true }).click();
      else if (target.site === "niconico")
        await chooseNico(page, "投稿日時が古い順");
      else if (target.site === "bluesky")
        await page.getByRole("tab", { name: "フィード", exact: true }).click();
      else
        await page
          .locator('article[data-testid="tweet"] a:has(time)')
          .filter({ visible: true })
          .first()
          .click();
      await expect(
        panel.getByText("このページはフィルター対象外です", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("combobox")).toHaveCount(0);
      await expect
        .poll(() => page.locator('[data-sift-filter-state="hidden"]').count())
        .toBe(0);
      await expect
        .poll(async () => (await readContext(session, page)).timelineAvailable)
        .toBe(false);

      if (target.site === "youtube")
        await page.getByRole("tab", { name: "動画", exact: true }).click();
      else if (target.site === "niconico")
        await chooseNico(page, "投稿日時が新しい順");
      else if (target.site === "bluesky")
        await page.getByRole("tab", { name: "投稿", exact: true }).click();
      else await page.goBack({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => (await readContext(session, page)).health?.state)
        .toBe("ready");
      await expect(
        panel.locator("[data-minimum-picker]").getByRole("combobox"),
      ).toBeVisible();
      await closePanel(session, page);
      opened = false;
      panel = await openPanel(session, page);
      opened = true;
      await expect(
        panel.locator("[data-minimum-picker]").getByRole("combobox"),
      ).toContainText("指定なし");
      await info.attach("lifecycle", {
        body: JSON.stringify({
          stages: [
            "filtered",
            "unsupported-cleared",
            "supported",
            "reopened-reset",
          ],
        }),
        contentType: "application/json",
      });
    } finally {
      try {
        if (opened || session.panelTargetId) await closePanel(session, page);
      } finally {
        await page.close();
      }
    }
  });
}
