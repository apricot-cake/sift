import { expect, test } from "@playwright/test";
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
test.beforeAll(async () => {
  session = await connectLive();
});
test.afterAll(async () => {
  if (session) await finishLive(session);
});

for (const target of unsupportedCases) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructured fixture arguments.
  test(target.id, async ({}, info) => {
    const page = await session.context.newPage();
    try {
      await page.bringToFront();
      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.ok(), "対象ページのHTTP応答が正常であること").toBe(true);
      if ("profileMedia" in target) {
        await page.locator('a[role="tab"][href="/AdamasMC/media"]').click();
        await expect(page).toHaveURL("https://x.com/AdamasMC/media");
        await expect(
          page.getByRole("tab", { name: "動画", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
      }
      if (target.id === "unsupported-x-images") {
        await page.locator('a[role="tab"][href="/uowata94/media"]').click();
        await page.getByRole("menuitem", { name: "画像", exact: true }).click();
        await expect(page).toHaveURL(
          "https://x.com/uowata94/media?filter=photo",
        );
        await expect(
          page.getByRole("tab", { name: "画像", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(
          page
            .locator('[data-testid="primaryColumn"] a[href*="/photo/"]')
            .first(),
        ).toBeVisible();
        await expect(page.locator('article[data-testid="tweet"]')).toHaveCount(
          0,
        );
      }
      if (target.site === "youtube") {
        const combo = page.locator(
          'ytd-browse:not([hidden]) [role="combobox"]',
        );
        const oldest = page.getByRole("tab", { name: /^(古い順|Oldest)$/ });
        await expect(combo.or(oldest).first()).toBeVisible();
        const dropdown = target.id.endsWith("dropdown");
        expect(
          (await combo.count()) > 0,
          "指定した表示形式が実際に存在すること",
        ).toBe(dropdown);
        if (dropdown) {
          await combo.click();
          await page
            .getByRole("menuitem", { name: /^(古い順|Oldest)$/ })
            .click();
          await expect(combo).toHaveText(/^(古い順|Oldest)$/);
        } else {
          await oldest.click();
          await expect(oldest).toHaveAttribute("aria-selected", "true");
        }
      } else if (target.site === "niconico" && "label" in target) {
        await page.locator(".Selectbox-button").click();
        await page.getByText(target.label, { exact: true }).click();
        await expect(page.locator(".Selectbox-button")).toHaveText(
          target.label,
        );
      } else if ("label" in target) {
        const tab = page.getByRole("tab", { name: target.label, exact: true });
        await tab.click();
        if (target.site === "bluesky")
          await expect(
            tab.locator('[style*="background-color"]').first(),
          ).toBeVisible();
        else await expect(tab).toHaveAttribute("aria-selected", "true");
      }
      if (target.site === "none")
        await expect(
          page.getByRole("heading", { name: "@apricot-cake", exact: true }),
        ).toBeVisible();
      const panel = await openPanel(session, page);
      await expect(
        panel.getByText(
          target.site === "none"
            ? "このページではフィルターを使えません"
            : "このページはフィルター対象外です",
          { exact: true },
        ),
      ).toBeVisible();
      if (target.id === "unsupported-x-images")
        await expect(
          panel.getByText("プロフィールの「ポスト」", {
            exact: true,
          }),
        ).toBeVisible();
      await expect(panel.getByRole("combobox")).toHaveCount(0);
      await expect(panel.getByRole("switch")).toHaveCount(0);
      await expect(
        page.locator('[data-sift-filter-state="hidden"]'),
      ).toHaveCount(0);
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
      await info.attach("unsupported-state", {
        body: JSON.stringify({
          state: "unsupported",
          controls: 0,
          hidden: 0,
          timelineAvailable: false,
        }),
        contentType: "application/json",
      });
    } finally {
      try {
        if (session.panelTargetId) await closePanel(session, page);
      } finally {
        await page.close();
      }
    }
  });
}
