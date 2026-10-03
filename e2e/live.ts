import fs from "node:fs";
import path from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Page,
  type Worker,
} from "@playwright/test";
import { artifactHash } from "../scripts/compatibility/artifact.ts";
import { readManagedDevBrowserEndpoint } from "../scripts/managed-dev-browser.ts";
import type { FilterContextResponse } from "../utils/filter-context.ts";

export const extensionId = "bohbpocokkfioejlabmeaimpkpmablkm";
export interface Candidate {
  buildId: string;
  output: string;
  sha256: string;
}
export interface LiveSession {
  browser: Browser;
  endpoint: string;
  panelBrowser?: Browser;
  panelTargetId?: string;
  context: BrowserContext;
  worker: Worker;
  candidate: Candidate;
  settings: unknown;
}

export async function connectLive(): Promise<LiveSession> {
  const endpoint = await readManagedDevBrowserEndpoint();
  const candidate: Candidate = JSON.parse(
    fs.readFileSync(".output/candidate.json", "utf8"),
  );
  expect(candidate.output).toBe(path.resolve(".output/candidate/chrome-mv3"));
  expect(artifactHash(candidate.output), "検証用成果物が変更されています").toBe(
    candidate.sha256,
  );
  const browser = await chromium.connectOverCDP(endpoint.url);
  const context = browser.contexts()[0];
  if (!context) throw new Error("開発用Chromeのコンテキストがありません");
  const worker =
    context
      .serviceWorkers()
      .find(
        (w) => w.url() === `chrome-extension://${extensionId}/background.js`,
      ) ??
    (await context.waitForEvent("serviceworker", {
      predicate: (w) =>
        w.url() === `chrome-extension://${extensionId}/background.js`,
    }));
  const settings = await worker.evaluate("chrome.storage.sync.get('settings')");
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(
    "test-results/compatibility-settings-before.json",
    JSON.stringify(settings, null, 2),
  );
  return {
    browser,
    endpoint: endpoint.url,
    context,
    worker,
    candidate,
    settings,
  };
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
    await session.panelBrowser?.close();
    await session.browser.close();
  }
}

export async function tabId(session: LiveSession, page: Page): Promise<number> {
  const url = page.url();
  return await session.worker.evaluate(
    "(async()=>{const tabs=(await chrome.tabs.query({active:true,lastFocusedWindow:true})).filter(t=>t.url===" +
      JSON.stringify(url) +
      ");if(tabs.length!==1)throw Error('対象タブが一意ではありません');return tabs[0].id;})()",
  );
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
    const cdp = await session.browser.newBrowserCDPSession();
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
  return await session.worker.evaluate(
    "chrome.tabs.sendMessage(" +
      (await tabId(session, page)) +
      ",{type:'sift:get-filter-context'})",
  );
}

/** 閉じた状態からの起動。通知・ページ幅・可視パネル・接続先を照合する。 */
export async function openPanel(
  session: LiveSession,
  page: Page,
): Promise<Page> {
  await page.bringToFront();
  const cdp = await session.browser.newBrowserCDPSession();
  const action = async () => {
    const targets = await cdp.send("Target.getTargets", {
      filter: [{ type: "tab" }, { exclude: true }],
    });
    const matching = targets.targetInfos.filter(
      (t) =>
        t.url === page.url() &&
        (t as typeof t & { embedderData?: { tabActive?: boolean } })
          .embedderData?.tabActive,
    );
    expect(matching).toHaveLength(1);
    if (!matching[0]) throw new Error("対象タブがありません");
    await cdp.send("Extensions.triggerAction", {
      id: extensionId,
      targetId: matching[0].targetId,
    });
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
    let panel: Page | undefined;
    // Chromeのサイドパネルは生成時の自動接続対象に入らない場合がある。
    // 生成後にCDP接続を作り直して、実パネルのPageを取得する。
    await session.panelBrowser?.close();
    session.panelBrowser = await chromium.connectOverCDP(session.endpoint);
    const panelContext = session.panelBrowser.contexts()[0];
    if (!panelContext) throw new Error("パネルのコンテキストがありません");
    await expect
      .poll(async () => {
        for (const candidate of panelContext
          .pages()
          .filter((p) => p.url().endsWith("/sidepanel.html"))) {
          const identity = await panelContext.newCDPSession(candidate);
          const target = await identity.send("Target.getTargetInfo");
          await identity.detach();
          if (target.targetInfo.targetId !== openedTargetId) continue;
          if (
            await candidate.evaluate(
              () =>
                document.visibilityState === "visible" &&
                innerWidth > 0 &&
                innerHeight > 0,
            )
          )
            panel = candidate;
        }
        return Boolean(panel);
      })
      .toBe(true);
    if (!panel) throw new Error("可視パネルがありません");
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
