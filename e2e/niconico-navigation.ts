import type { Page } from "puppeteer-core";
import { expect } from "vitest";
import { aria, text } from "./browser-queries.ts";

/** 並び順だけ先に更新された状態と、実際の一覧の準備完了を区別する。 */
export function readNiconicoUserListState() {
  const buttons = [...document.querySelectorAll(".Selectbox-button")].filter(
    (node) => node.checkVisibility({ visibilityProperty: true }),
  );
  const videoLinks = [
    ...document.querySelectorAll('a[href*="/watch/"]'),
  ].filter((node) => node.checkVisibility({ visibilityProperty: true }));
  const label = buttons.length === 1 ? buttons[0]?.textContent?.trim() : null;
  return {
    label,
    videoLinks: videoLinks.length,
    ready: !!label && videoLinks.length > 0,
  };
}

/** 並び替えの遷移と、新しい操作欄・実動画の描画まで待つ。再取得は行わない。 */
export async function selectNiconicoUserSort(page: Page, label: string) {
  const before = new URL(page.url());
  expect(before.origin).toBe("https://www.nicovideo.jp");
  expect(before.pathname).toMatch(/^\/user\/\d+\/video\/?$/);
  await expect
    .poll(async () => (await page.evaluate(readNiconicoUserListState)).ready, {
      timeout: 30000,
    })
    .toBe(true);
  const changed =
    (await page.evaluate(readNiconicoUserListState)).label !== label;
  if (changed) {
    await page.locator(".Selectbox-button").click();
    // URLだけが先に変わっても、次ケースが古い文書へ操作を送らないようにする。
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      page.locator(text(label)).click(),
    ]);
  }
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(readNiconicoUserListState);
        const current = new URL(page.url());
        return (
          current.origin === before.origin &&
          current.pathname === before.pathname &&
          state.label === label &&
          state.ready
        );
      },
      { timeout: 30000 },
    )
    .toBe(true);
  return {
    url: page.url(),
    expectedLabel: label,
    changed,
    ...(await page.evaluate(readNiconicoUserListState)),
  };
}

const searchSortLabels = {
  registeredAt: "投稿日時",
  viewCount: "再生数",
} as const;

/** 同じキーワードの検索を、サイトのソート操作だけで切り替える。 */
export async function selectNiconicoSearchSort(
  page: Page,
  expectedUrl: string,
) {
  const expected = new URL(expectedUrl);
  const current = new URL(page.url());
  expect(current.origin).toBe(expected.origin);
  expect(current.pathname).toBe(expected.pathname);
  expect(expected.pathname.startsWith("/search/")).toBe(true);
  const sort = expected.searchParams.get("sort");
  const order = expected.searchParams.get("order");
  const actions: string[] = [];

  // 無指定の検索順はサイトの既定値を使う。キーを推測して復元しない。
  // 共用グループの先頭を無指定ケースとし、単独実行では元の URL を開く。
  if (sort === null && order === null) {
    expect(current.searchParams.get("sort")).toBeNull();
    expect(current.searchParams.get("order")).toBeNull();
    expect(current.searchParams.get("page")).toBeNull();
    return { url: page.url(), actions };
  }
  if (sort !== "registeredAt" && sort !== "viewCount")
    throw new Error(`未定義の検証用検索順です: ${sort}`);
  if (order !== "asc" && order !== "desc")
    throw new Error(`未定義の検証用昇降順です: ${order}`);

  const key = aria("combobox", "ソートキーを選択");
  const label = searchSortLabels[sort];
  await page.locator(key).wait();
  const readKey = () =>
    page.$eval(key, (node) => (node.textContent ?? "").trim());
  if ((await readKey()) !== label) {
    await page.locator(key).click();
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      page.locator(aria("option", label)).click(),
    ]);
    actions.push(`sort:${sort}`);
  }
  await expect.poll(readKey).toBe(label);
  // 操作欄だけが先に変わるため、URLのソートキーも一致してから次へ進む。
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort") ?? "registeredAt")
    .toBe(sort);

  // 保存済みの実ページでは、降順時に「昇順に切り替え」と表示される。
  // URL と反対方向への操作ラベルを両方照合する。
  const selectedOrderLabel =
    order === "asc" ? "降順に切り替え" : "昇順に切り替え";
  const direction = "button[aria-label$='順に切り替え']";
  const readDirectionLabels = () =>
    page.$$eval(direction, (nodes) =>
      nodes
        .filter((node) => node.checkVisibility({ visibilityProperty: true }))
        .map((node) => node.getAttribute("aria-label")),
    );
  await expect.poll(async () => (await readDirectionLabels()).length).toBe(1);
  await expect
    .poll(async () => {
      const currentOrder =
        new URL(page.url()).searchParams.get("order") ?? "desc";
      const expectedLabel =
        currentOrder === "asc" ? "降順に切り替え" : "昇順に切り替え";
      return (await readDirectionLabels())[0] === expectedLabel;
    })
    .toBe(true);
  const currentDirectionLabel = (await readDirectionLabels())[0];
  expect(["昇順に切り替え", "降順に切り替え"]).toContain(currentDirectionLabel);
  if (currentDirectionLabel !== selectedOrderLabel) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }),
      page.locator(aria("button", currentDirectionLabel ?? "")).click(),
    ]);
    actions.push(`order:${order}`);
  }
  await expect.poll(readDirectionLabels).toEqual([selectedOrderLabel]);
  // 実サイトは既定の投稿日時・降順を URL から省略する。
  // 省略値は上のキー表示・反対方向の操作ラベルとの一致で確認する。
  await expect.poll(readKey).toBe(label);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort") ?? "registeredAt")
    .toBe(sort);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("order") ?? "desc")
    .toBe(order);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("page"))
    .toBeNull();
  expect(new URL(page.url()).origin).toBe(expected.origin);
  expect(new URL(page.url()).pathname).toBe(expected.pathname);
  const actual = new URL(page.url());
  return {
    url: page.url(),
    actions,
    selected: {
      sortLabel: await readKey(),
      orderSwitchLabel: selectedOrderLabel,
    },
    query: {
      sort: actual.searchParams.get("sort"),
      order: actual.searchParams.get("order"),
    },
    effective: { sort, order },
    omittedDefaults: {
      sort: !actual.searchParams.has("sort"),
      order: !actual.searchParams.has("order"),
    },
  };
}
