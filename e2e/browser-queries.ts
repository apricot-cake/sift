import type { ElementHandle, Page } from "puppeteer-core";
import { expect, type RunnerTask } from "vitest";

/** Puppeteer の公開 ARIA セレクターを組み立てる。 */
export function aria(role: string, name?: string | readonly string[]): string {
  if (Array.isArray(name))
    return name.map((value) => aria(role, value)).join(", ");
  return `::-p-aria([role=${JSON.stringify(role)}]${name === undefined ? "" : `[name=${JSON.stringify(name)}]`})`;
}

export function text(value: string | readonly string[]): string {
  if (Array.isArray(value)) return value.map(text).join(", ");
  return `::-p-text(${JSON.stringify(value)})`;
}

export async function visible(page: Page, selector: string): Promise<boolean> {
  const nodes = await page.$$(selector);
  try {
    for (const node of nodes) if (await node.isVisible()) return true;
    return false;
  } finally {
    await Promise.all(nodes.map((node) => node.dispose()));
  }
}

export async function element(
  page: Page,
  selector: string,
  index = 0,
): Promise<ElementHandle<Element>> {
  if (index === 0) {
    const chosen = await page.waitForSelector(selector, {
      visible: true,
      timeout: 10000,
    });
    if (!chosen) throw new Error(`対象要素がありません: ${selector}`);
    return chosen;
  }
  await expect
    .poll(() => page.$$eval(selector, (nodes) => nodes.length), {
      timeout: 10000,
    })
    .toBeGreaterThan(index);
  const nodes = await page.$$(selector);
  const chosen = nodes[index];
  await Promise.all(
    nodes.filter((node) => node !== chosen).map((node) => node.dispose()),
  );
  if (!chosen) throw new Error(`対象要素がありません: ${selector}`);
  return chosen;
}

/** controlled な数値入力を、選択範囲への入力1回で置き換える。 */
export async function fillNumber(page: Page, selector: string, value: number) {
  const input = await element(page, selector);
  try {
    await input.click();
    await page.keyboard.down("Control");
    try {
      await input.press("A");
    } finally {
      await page.keyboard.up("Control");
    }
    await page.keyboard.sendCharacter(String(value));
    await input.press("Enter");
    await expect
      .poll(() => input.evaluate((node) => (node as HTMLInputElement).value))
      .toBe(String(value));
  } finally {
    await input.dispose();
  }
}

/** 可視要素を返す関数を再評価し、Puppeteer の待ち条件付きでクリックする。 */
export async function clickVisible(page: Page, query: () => Element | null) {
  await page
    .locator(query)
    .filter((node): node is Element => node !== null)
    .click();
}

export async function evidence(
  task: RunnerTask,
  name: string,
  attachment: { body: string; contentType: string },
) {
  task.meta.liveEvidence ??= [];
  const entries = task.meta.liveEvidence;
  entries.push({
    name,
    data:
      attachment.contentType === "application/json"
        ? JSON.parse(attachment.body)
        : { message: attachment.body },
  });
}
