import type { ElementHandle, Page } from "puppeteer-core";
import { expect } from "vitest";

// pipe 接続で取得した実構造: チャンネル内は name=query、masthead は search_query。
export const youtubeChannelSearchInputSelector =
  'ytd-browse:not([hidden]) input[name="query"]';

/** 共有する検索結果は、同じチャンネルの検索画面に限定する。 */
export function youtubeSearchRoute(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.origin !== "https://www.youtube.com" ||
    !/^\/@[^/]+\/search$/.test(parsed.pathname)
  )
    throw new Error("YouTube のチャンネル内検索 URL が必要です");
  return parsed.origin + parsed.pathname;
}

/** 遷移先には検索語が必要だが、現在の検索画面は未入力でも共用できる。 */
export function youtubeSearchQuery(destination: string): string {
  youtubeSearchRoute(destination);
  const query = new URL(destination).searchParams.get("query");
  if (!query) throw new Error("YouTube の検索先には検索語が必要です");
  return query;
}

/** 既存の検索結果で、サイト自身の入力欄から検索語を一度だけ変更する。 */
export async function changeYoutubeChannelSearch(
  page: Page,
  destination: string,
): Promise<boolean> {
  const current = new URL(page.url());
  const target = new URL(destination);
  if (youtubeSearchRoute(current.href) !== youtubeSearchRoute(target.href))
    throw new Error("共有する YouTube の検索結果が別チャンネルです");
  const before = current.searchParams.get("query");
  const query = youtubeSearchQuery(target.href);
  if (before === query) return false;

  // URL に検索語があるときは入力値も照合する。検索タブだけの URL では
  // 前の検索語が入力欄に残ることがあるため、現在値による限定は行わない。
  const candidates = await page.$$(youtubeChannelSearchInputSelector);
  try {
    const matching: ElementHandle<Element>[] = [];
    for (const node of candidates)
      if (
        (await node.isVisible()) &&
        (await node.evaluate(
          (element, value) =>
            element instanceof HTMLInputElement &&
            (element.type === "text" || element.type === "search") &&
            !element.disabled &&
            !element.readOnly &&
            (value === null || element.value === value),
          before,
        ))
      )
        matching.push(node);
    if (matching.length !== 1)
      throw new Error(
        `チャンネル内検索欄を一意に確認できません: ${matching.length} 件`,
      );
    const input = matching[0];
    if (!input) throw new Error("チャンネル内検索欄が見つかりません");
    await input.click();
    await page.keyboard.down("Control");
    try {
      await input.press("A");
    } finally {
      await page.keyboard.up("Control");
    }
    await page.keyboard.sendCharacter(query);
    await expect
      .poll(() => input.evaluate((node) => (node as HTMLInputElement).value))
      .toBe(query);
    await input.press("Enter");
    await expect
      .poll(() => youtubeSearchRoute(page.url()))
      .toBe(youtubeSearchRoute(target.href));
    await expect
      .poll(() => new URL(page.url()).searchParams.get("query"))
      .toBe(query);
    return true;
  } finally {
    await Promise.all(candidates.map((node) => node.dispose()));
  }
}
