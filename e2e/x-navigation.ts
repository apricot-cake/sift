import type { Page } from "puppeteer-core";
import { expect } from "vitest";
import { element } from "./browser-queries.ts";

// 文書を開き直さず、サイトの検索欄で次のケースの検索語へ切り替える。
export async function changeXSearch(page: Page, expectedUrl: string) {
  const expected = new URL(expectedUrl);
  const current = new URL(page.url());
  expect(current.origin).toBe(expected.origin);
  expect(current.pathname).toBe("/search");
  const query = expected.searchParams.get("q");
  if (!query) throw new Error("検証する検索語がありません");
  if (current.searchParams.get("q") !== query) {
    const input = await element(page, '[data-testid="SearchBox_Search_Input"]');
    try {
      await input.click();
      await page.keyboard.down("Control");
      try {
        await input.press("A");
      } finally {
        await page.keyboard.up("Control");
      }
      await page.keyboard.sendCharacter(query);
      await input.press("Enter");
    } finally {
      await input.dispose();
    }
  }
  await expect.poll(() => new URL(page.url()).pathname).toBe("/search");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe(query);
}
