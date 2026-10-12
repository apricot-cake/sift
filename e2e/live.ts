import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "puppeteer-core";
import { expect } from "vitest";
import type { ExtensionWorker } from "../scripts/browser-worker.ts";
import { artifactHash } from "../scripts/compatibility/artifact.ts";
import { loadDevCandidate } from "../scripts/dev-browser-candidate.ts";
import { launchDevBrowser } from "../scripts/managed-dev-browser.ts";
import type { FilterContextResponse } from "../utils/filter-context.ts";

export const extensionId = "bohbpocokkfioejlabmeaimpkpmablkm";
export interface Candidate {
  buildId: string;
  output: string;
  sha256: string;
}
export interface LiveSession {
  browser: Browser;
  panelTargetId?: string;
  context: BrowserContext;
  worker: ExtensionWorker;
  candidate: Candidate;
  settings: unknown;
}

export async function connectLive(): Promise<LiveSession> {
  const candidate: Candidate = JSON.parse(
    fs.readFileSync(".output/candidate.json", "utf8"),
  );
  expect(candidate.output).toBe(path.resolve(".output/candidate/chrome-mv3"));
  expect(artifactHash(candidate.output), "検証用成果物が変更されています").toBe(
    candidate.sha256,
  );
  const browser = await launchDevBrowser(true);
  try {
    const loaded = await loadDevCandidate(browser).catch((cause) => {
      throw new Error("実機検証用の候補を読み込めません", { cause });
    });
    expect(loaded.loaded.id).toBe(extensionId);
    const context = browser.defaultBrowserContext();
    const worker = loaded.worker;
    const settings = await worker.evaluate(
      "chrome.storage.sync.get('settings')",
    );
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(
      "test-results/compatibility-settings-before.json",
      JSON.stringify(settings, null, 2),
    );
    return {
      browser,
      context,
      worker,
      candidate,
      settings,
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function finishLive(session: LiveSession) {
  try {
    const settings = session.settings as Record<string, unknown>;
    await session.worker.evaluate(
      Object.hasOwn(settings, "settings")
        ? `chrome.storage.sync.set(${JSON.stringify(settings)})`
        : "chrome.storage.sync.remove('settings')",
    );
  } finally {
    try {
      await session.worker.dispose();
    } finally {
      await session.browser.close();
    }
  }
}

export async function tabId(session: LiveSession, page: Page): Promise<number> {
  const url = page.url();
  const id = await session.worker.evaluate(
    "(async()=>{const tabs=(await chrome.tabs.query({})).filter(t=>t.url===" +
      JSON.stringify(url) +
      ");if(tabs.length!==1)throw Error('対象タブが一意ではありません');return tabs[0].id;})()",
  );
  if (typeof id !== "number") throw new Error("対象タブの ID を取得できません");
  return id;
}

export async function closePanel(session: LiveSession, page: Page) {
  const id = await tabId(session, page);
  const width = await page.evaluate(() => innerWidth);
  await session.worker.evaluate(
    `(()=>{globalThis.__compatibilityCloseDone=false;globalThis.__compatibilityFinalCloseListener=e=>{if(e.tabId===${id})globalThis.__compatibilityCloseDone=true};chrome.sidePanel.onClosed.addListener(globalThis.__compatibilityFinalCloseListener)})()`,
  );
  try {
    await session.worker.evaluate(`chrome.sidePanel.close({tabId:${id}})`);
    await expect
      .poll(() =>
        session.worker.evaluate("globalThis.__compatibilityCloseDone"),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => innerWidth))
      .toBeGreaterThan(width);
  } finally {
    await session.worker.evaluate(
      "(()=>{chrome.sidePanel.onClosed.removeListener(globalThis.__compatibilityFinalCloseListener);delete globalThis.__compatibilityFinalCloseListener;delete globalThis.__compatibilityCloseDone})()",
    );
  }
  if (session.panelTargetId) {
    const cdp = await session.browser.target().createCDPSession();
    try {
      const targets = await cdp.send("Target.getTargets");
      if (
        targets.targetInfos.some(
          (target) => target.targetId === session.panelTargetId,
        )
      )
        await cdp.send("Target.closeTarget", {
          targetId: session.panelTargetId,
        });
      session.panelTargetId = undefined;
    } finally {
      await cdp.detach();
    }
  }
}

export async function readContext(
  session: LiveSession,
  page: Page,
): Promise<FilterContextResponse> {
  return (await session.worker.evaluate(
    "chrome.tabs.sendMessage(" +
      (await tabId(session, page)) +
      ",{type:'sift:get-filter-context'})",
  )) as FilterContextResponse;
}

/** 閉じた状態からの起動。通知・ページ幅・可視パネル・接続先を照合する。 */
export async function openPanel(
  session: LiveSession,
  page: Page,
): Promise<Page> {
  await page.bringToFront();
  const cdp = await session.browser.target().createCDPSession();
  const action = async () => {
    const extension = (await session.browser.extensions()).get(extensionId);
    if (!extension) throw new Error("拡張機能がありません");
    await page.triggerExtensionAction(extension);
  };
  try {
    const originalTargets = new Set(
      (await cdp.send("Target.getTargets")).targetInfos.map(
        (target) => target.targetId,
      ),
    );
    await session.worker.evaluate(
      "(()=>{globalThis.__compatibilityOpened=[];globalThis.__compatibilityClosed=[];globalThis.__compatibilityListener=e=>globalThis.__compatibilityOpened.push(e);globalThis.__compatibilityCloseListener=e=>globalThis.__compatibilityClosed.push(e);chrome.sidePanel.onOpened.addListener(globalThis.__compatibilityListener);chrome.sidePanel.onClosed.addListener(globalThis.__compatibilityCloseListener);})()",
    );
    const preparationWidth = await page.evaluate(() => innerWidth);
    await action(); // 初回権限取得は開閉の合格に数えない。
    const id = await tabId(session, page);
    await expect
      .poll(() =>
        session.worker.evaluate(
          `globalThis.__compatibilityOpened.some(e=>e.tabId===${id})`,
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => innerWidth))
      .toBeLessThan(preparationWidth);
    await closePanel(session, page);
    await expect
      .poll(() =>
        session.worker.evaluate(
          `globalThis.__compatibilityClosed.some(e=>e.tabId===${id})`,
        ),
      )
      .toBe(true);
    // CDP接続中は閉じたパネルのrendererが残る場合がある。自分で生成したものだけ破棄する。
    for (const target of (await cdp.send("Target.getTargets")).targetInfos) {
      if (
        !originalTargets.has(target.targetId) &&
        target.url === `chrome-extension://${extensionId}/sidepanel.html`
      )
        await cdp.send("Target.closeTarget", { targetId: target.targetId });
    }
    const beforeOpen = new Set(
      (await cdp.send("Target.getTargets")).targetInfos.map(
        (target) => target.targetId,
      ),
    );
    const width = await page.evaluate(() => innerWidth);
    await session.worker.evaluate("globalThis.__compatibilityOpened=[]");
    await action();
    await expect
      .poll(() =>
        session.worker.evaluate(
          "globalThis.__compatibilityOpened.some(e=>e.tabId===" +
            id +
            "&&e.path.replace(/^\\//,'')==='sidepanel.html')",
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => innerWidth))
      .toBeLessThan(width);
    const newPanels = (await cdp.send("Target.getTargets")).targetInfos.filter(
      (target) =>
        !beforeOpen.has(target.targetId) &&
        target.url === `chrome-extension://${extensionId}/sidepanel.html`,
    );
    expect(newPanels).toHaveLength(1);
    const openedTargetId = newPanels[0]?.targetId;
    if (!openedTargetId) throw new Error("今回開いたパネルを特定できません");
    session.panelTargetId = openedTargetId;
    const panelTarget = await session.browser.waitForTarget(
      async (target) => {
        if (target.url() !== `chrome-extension://${extensionId}/sidepanel.html`)
          return false;
        const identity = await target.createCDPSession();
        try {
          return (
            (await identity.send("Target.getTargetInfo")).targetInfo
              .targetId === openedTargetId
          );
        } finally {
          await identity.detach();
        }
      },
      { timeout: 10000 },
    );
    const panel = await panelTarget.asPage();
    panel.setDefaultTimeout(10000);
    panel.setDefaultNavigationTimeout(30000);
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            document.visibilityState === "visible" &&
            innerWidth > 0 &&
            innerHeight > 0,
        ),
      )
      .toBe(true);
    const running = await panel.evaluate(
      "chrome.runtime.sendMessage({type:'sift:get-local-build'})",
    );
    expect(
      running,
      "稼働中のバックグラウンドが検証対象ビルドと一致しません",
    ).toEqual({ buildId: session.candidate.buildId });
    expect(
      await panel.evaluate(
        "(async()=>{const [t]=await chrome.tabs.query({active:true,currentWindow:true});return t.id;})()",
      ),
    ).toBe(id);
    return panel;
  } finally {
    await session.worker
      .evaluate(
        "(()=>{if(globalThis.__compatibilityListener)chrome.sidePanel.onOpened.removeListener(globalThis.__compatibilityListener);if(globalThis.__compatibilityCloseListener)chrome.sidePanel.onClosed.removeListener(globalThis.__compatibilityCloseListener);delete globalThis.__compatibilityListener;delete globalThis.__compatibilityCloseListener;delete globalThis.__compatibilityOpened;delete globalThis.__compatibilityClosed;})()",
      )
      .catch(() => {});
    await cdp.detach();
  }
}
