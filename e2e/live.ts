import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "puppeteer-core";
import { expect, type RunnerTask } from "vitest";
import { workerCommandTimeout } from "../scripts/browser-worker.ts";
import { artifactHash } from "../scripts/compatibility/artifact.ts";
import { LiveLoadGuard, liveSite } from "../scripts/compatibility/live-load.ts";
import { loadDevCandidate } from "../scripts/dev-browser-candidate.ts";
import {
  createExtensionApiContext,
  type ExtensionApiContext,
} from "../scripts/extension-api-context.ts";
import { launchDevBrowser } from "../scripts/managed-dev-browser.ts";
import { isOwnedPanelEvent, isOwnedPanelUrl } from "../scripts/panel-target.ts";
import type { FilterContextResponse } from "../utils/filter-context.ts";
import { evidence } from "./browser-queries.ts";

export const extensionId = "bohbpocokkfioejlabmeaimpkpmablkm";
let panelOperation = 0;
const observedPanelGrantPages = new WeakSet<Page>();
function panelOperationKey() {
  return `__siftPanelOperation${++panelOperation}`;
}
export interface Candidate {
  buildId: string;
  output: string;
  sha256: string;
}
export interface LiveSession {
  loadGuard: LiveLoadGuard;
  casePage?: { key: string; page: Page; coldSite?: string };
  coldSites: Set<string>;
  preparedPanelOrigins: Map<number, string>;
  panelObservers?: Set<() => Promise<void>>;
  browser: Browser;
  panelTargetId?: string;
  context: BrowserContext;
  api: ExtensionApiContext;
  candidate: Candidate;
  settings: unknown;
  settingsBackup: string;
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
    await loaded.worker.dispose();
    const api = await createExtensionApiContext(context, extensionId);
    const settings = await api.evaluate("chrome.storage.sync.get('settings')");
    fs.mkdirSync("test-results", { recursive: true });
    const runId = (
      process.env.SIFT_LIVE_RUN_ID ?? new Date().toISOString()
    ).replace(/[:.]/g, "-");
    const settingsBackup = path.join(
      "test-results",
      `compatibility-settings-before-${runId}-${randomUUID()}.json`,
    );
    fs.writeFileSync(settingsBackup, JSON.stringify(settings, null, 2));
    return {
      loadGuard: new LiveLoadGuard(),
      coldSites: new Set(),
      preparedPanelOrigins: new Map(),
      browser,
      context,
      api,
      candidate,
      settings,
      settingsBackup,
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function finishLive(session: LiveSession) {
  try {
    for (const dispose of session.panelObservers ?? []) await dispose();
    // 退避した強い条件を実サイトへ再適用して追加取得を起こさない。
    if (session.casePage) {
      await session.casePage.page.close();
      session.casePage = undefined;
    }
    const settings = session.settings as Record<string, unknown>;
    const restore = Object.hasOwn(settings, "settings")
      ? `chrome.storage.sync.set(${JSON.stringify(settings)})`
      : "chrome.storage.sync.remove('settings')";
    try {
      await session.api.evaluate(restore);
      expect(
        await session.api.evaluate("chrome.storage.sync.get('settings')"),
        "検証前の設定を復元できません",
      ).toEqual(settings);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/実行contextが失効|Target closed|Session closed|Cannot find context|Execution context was destroyed|unique context.*not found/i.test(
          error.message,
        )
      )
        throw error;
      // ケースの合否は変えず、終了処理だけを同一拡張機能の静的rendererで完了する。
      const record = {
        apiError: String(error),
        fallback: "extension-renderer",
        restored: false,
      };
      const cleanupLog = `${session.settingsBackup}.cleanup.json`;
      fs.writeFileSync(cleanupLog, JSON.stringify(record, null, 2));
      console.warn(
        "[sift] 設定復元時にAPI観測contextが失効していました。",
        String(error),
      );
      const restoreApi = await createExtensionApiContext(
        session.context,
        extensionId,
      );
      try {
        await restoreApi.evaluate(restore);
        const restored = await restoreApi.evaluate(
          "chrome.storage.sync.get('settings')",
        );
        expect(restored, "検証前の設定をrendererから復元できません").toEqual(
          settings,
        );
        record.restored = true;
      } finally {
        try {
          await restoreApi.dispose();
        } finally {
          fs.writeFileSync(cleanupLog, JSON.stringify(record, null, 2));
        }
      }
    }
  } finally {
    try {
      if (session.casePage) await session.casePage.page.close();
    } finally {
      try {
        await session.api.dispose();
      } finally {
        await session.browser.close();
      }
    }
  }
}

export async function acquireCasePage(
  session: LiveSession,
  key: string,
): Promise<{ page: Page; reused: boolean }> {
  session.loadGuard.budget.assert(liveSite(key));
  if (session.casePage?.key === key && !session.casePage.page.isClosed()) {
    await session.loadGuard.assertPage(session.casePage.page);
    session.loadGuard.beginCase(session.casePage.page);
    return { page: session.casePage.page, reused: true };
  }
  if (session.casePage) await session.casePage.page.close();
  const page = await session.context.newPage();
  await session.loadGuard.watch(page);
  const site = liveSite(key);
  if (site && !session.coldSites.has(site)) {
    await page.setCacheEnabled(false);
  }
  session.casePage = {
    key,
    page,
    coldSite: site && !session.coldSites.has(site) ? site : undefined,
  };
  return { page, reused: false };
}

/** 実一覧の初期化を確認してからキャッシュを戻し、後続の操作は再取得を抑える。 */
export async function completeInitialLoad(
  session: LiveSession,
  page: Page,
  task: RunnerTask,
  state: "ready" | "empty" | "unsupported",
) {
  const current = session.casePage;
  if (!current || current.page !== page)
    throw new Error("初期化を確認したページが現在の検証対象と一致しません。");
  const coldSite = current.coldSite;
  if (coldSite) {
    await page.setCacheEnabled(true);
    session.coldSites.add(coldSite);
    current.coldSite = undefined;
  }
  await evidence(task, "initialization-cache", {
    body: JSON.stringify({
      site: liveSite(current.key),
      cacheDisabledDuringInitialization: !!coldSite,
      state,
      cacheRestored: true,
    }),
    contentType: "application/json",
  });
}
export async function releaseCasePage(
  session: LiveSession,
  key: string,
  healthy: boolean,
) {
  if (session.casePage?.key !== key) return;
  if (healthy) await session.loadGuard.assertPage(session.casePage.page);
  else {
    await session.casePage.page.close();
    session.casePage = undefined;
  }
}

export async function assertLivePage(session: LiveSession, page: Page) {
  await session.loadGuard.assertPage(page);
}

export async function tabId(session: LiveSession, page: Page): Promise<number> {
  const url = page.url();
  const id = await session.api.evaluate(
    "(async()=>{const tabs=(await chrome.tabs.query({})).filter(t=>t.url===" +
      JSON.stringify(url) +
      ");if(tabs.length!==1)throw Error('対象タブが一意ではありません');return tabs[0].id;})()",
  );
  if (typeof id !== "number") throw new Error("対象タブの ID を取得できません");
  return id;
}

export async function closePanel(session: LiveSession, page: Page) {
  const key = JSON.stringify(panelOperationKey());
  const ownedTargetId = session.panelTargetId;
  let failure: unknown;
  let failed = false;
  try {
    const id = await tabId(session, page);
    const width = await page.evaluate(() => innerWidth);
    await session.api.evaluate(
      `(()=>{const state=globalThis[${key}]={done:false};state.listener=e=>{if(e.tabId===${id})state.done=true};chrome.sidePanel.onClosed.addListener(state.listener)})()`,
    );
    try {
      await session.api.evaluate(`chrome.sidePanel.close({tabId:${id}})`);
      await expect
        .poll(() => session.api.evaluate(`globalThis[${key}]?.done`))
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => innerWidth))
        .toBeGreaterThan(width);
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      await session.api
        .evaluate(
          `(()=>{const state=globalThis[${key}];if(state)chrome.sidePanel.onClosed.removeListener(state.listener);delete globalThis[${key}]})()`,
        )
        .catch((error) => {
          if (!failed) throw error;
        });
    }
  } catch (error) {
    failure = error;
    failed = true;
  }
  // 通知の検証が失敗しても、所有するrendererの回収は済ませる。
  try {
    await disposePanelTarget(session, ownedTargetId);
  } catch (error) {
    if (!failed) throw error;
  }
  if (failed) throw failure;
}

async function disposePanelTarget(
  session: LiveSession,
  ownedTargetId?: string,
) {
  if (ownedTargetId) {
    const cdp = await session.browser.target().createCDPSession();
    try {
      const targets = await cdp.send("Target.getTargets", undefined, {
        timeout: workerCommandTimeout,
      });
      if (
        targets.targetInfos.some((target) => target.targetId === ownedTargetId)
      )
        await cdp.send(
          "Target.closeTarget",
          {
            targetId: ownedTargetId,
          },
          { timeout: workerCommandTimeout },
        );
      if (session.panelTargetId === ownedTargetId)
        session.panelTargetId = undefined;
    } finally {
      await cdp.detach();
    }
  }
}

/** 遷移前に登録し、自動閉鎖の通知・幅復元を確認してから自分のrendererを回収する。 */
export async function observeAutomaticPanelClose(
  session: LiveSession,
  page: Page,
) {
  const key = JSON.stringify(panelOperationKey());
  const id = await tabId(session, page);
  const width = await page.evaluate(() => innerWidth);
  const target = session.panelTargetId;
  await session.api.evaluate(
    `(()=>{const state=globalThis[${key}]={done:false};state.listener=e=>{if(e.tabId===${id})state.done=true};chrome.sidePanel.onClosed.addListener(state.listener)})()`,
  );
  const dispose = async () => {
    await session.api.evaluate(
      `(()=>{const state=globalThis[${key}];if(state)chrome.sidePanel.onClosed.removeListener(state.listener);delete globalThis[${key}]})()`,
    );
    session.panelObservers?.delete(dispose);
  };
  session.panelObservers ??= new Set();
  session.panelObservers.add(dispose);
  return async () => {
    try {
      await expect
        .poll(() => session.api.evaluate(`globalThis[${key}]?.done`))
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => innerWidth))
        .toBeGreaterThan(width);
      await disposePanelTarget(session, target);
    } finally {
      await dispose();
    }
  };
}

export async function readContext(
  session: LiveSession,
  page: Page,
): Promise<FilterContextResponse> {
  session.loadGuard.budget.assert(liveSite(page.url()));
  return (await session.api.evaluate(
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
  await session.loadGuard.watch(page);
  await session.loadGuard.assertPage(page);
  await page.bringToFront();
  const cdp = await session.browser.target().createCDPSession();
  const key = JSON.stringify(panelOperationKey());
  let originalTargets: Set<string> | undefined;
  let ownerTabId: number | undefined;
  let completed = false;
  const action = async () => {
    const extension = (await session.browser.extensions()).get(extensionId);
    if (!extension) throw new Error("拡張機能がありません");
    await page.triggerExtensionAction(extension);
  };
  try {
    originalTargets = new Set(
      (
        await cdp.send("Target.getTargets", undefined, {
          timeout: workerCommandTimeout,
        })
      ).targetInfos.map((target) => target.targetId),
    );
    await session.api.evaluate(
      `(()=>{const state=globalThis[${key}]={opened:[],closed:[]};state.openListener=e=>state.opened.push(e);state.closeListener=e=>state.closed.push(e);chrome.sidePanel.onOpened.addListener(state.openListener);chrome.sidePanel.onClosed.addListener(state.closeListener);})()`,
    );
    ownerTabId = (await session.api.evaluate(
      "(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return tab?.id;})()",
    )) as number;
    if (!Number.isSafeInteger(ownerTabId) || ownerTabId <= 0)
      throw new Error("所有タブの ID を取得できません");
    const id = ownerTabId;
    if (!observedPanelGrantPages.has(page)) {
      observedPanelGrantPages.add(page);
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        try {
          if (
            session.preparedPanelOrigins.get(id) !== new URL(frame.url()).origin
          )
            session.preparedPanelOrigins.delete(id);
        } catch {
          session.preparedPanelOrigins.delete(id);
        }
      });
      page.once("close", () => session.preparedPanelOrigins.delete(id));
    }
    const origin = new URL(page.url()).origin;
    if (session.preparedPanelOrigins.get(ownerTabId) !== origin) {
      const preparationWidth = await page.evaluate(() => innerWidth);
      await action(); // 初回権限取得は開閉の合格に数えない。
      expect(await tabId(session, page)).toBe(ownerTabId);
      await expect
        .poll(() =>
          session.api.evaluate(
            `globalThis[${key}]?.opened.some(e=>e.tabId===${id})`,
          ),
        )
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => innerWidth))
        .toBeLessThan(preparationWidth);
      await closePanel(session, page);
      await expect
        .poll(() =>
          session.api.evaluate(
            `globalThis[${key}]?.closed.some(e=>e.tabId===${id})`,
          ),
        )
        .toBe(true);
      // CDP接続中は閉じたパネルのrendererが残る場合がある。自分で生成したものだけ破棄する。
      for (const target of (
        await cdp.send("Target.getTargets", undefined, {
          timeout: workerCommandTimeout,
        })
      ).targetInfos) {
        if (
          !originalTargets.has(target.targetId) &&
          ownerTabId !== undefined &&
          isOwnedPanelUrl(target.url, extensionId, ownerTabId)
        )
          await cdp.send(
            "Target.closeTarget",
            { targetId: target.targetId },
            { timeout: workerCommandTimeout },
          );
      }
      session.preparedPanelOrigins.set(ownerTabId, origin);
    }
    const beforeOpen = new Set(
      (
        await cdp.send("Target.getTargets", undefined, {
          timeout: workerCommandTimeout,
        })
      ).targetInfos.map((target) => target.targetId),
    );
    const width = await page.evaluate(() => innerWidth);
    await session.api.evaluate(`globalThis[${key}].opened=[]`);
    await action();
    await expect
      .poll(async () => {
        const opened = (await session.api.evaluate(
          `globalThis[${key}]?.opened ?? []`,
        )) as { tabId: number; path: string }[];
        return opened.some((event) =>
          isOwnedPanelEvent(event, extensionId, id),
        );
      })
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => innerWidth))
      .toBeLessThan(width);
    const newPanels = (
      await cdp.send("Target.getTargets", undefined, {
        timeout: workerCommandTimeout,
      })
    ).targetInfos.filter(
      (target) =>
        !beforeOpen.has(target.targetId) &&
        ownerTabId !== undefined &&
        isOwnedPanelUrl(target.url, extensionId, ownerTabId),
    );
    expect(newPanels).toHaveLength(1);
    const openedTargetId = newPanels[0]?.targetId;
    if (!openedTargetId) throw new Error("今回開いたパネルを特定できません");
    session.panelTargetId = openedTargetId;
    const panelTarget = await session.browser.waitForTarget(
      async (target) => {
        if (!isOwnedPanelUrl(target.url(), extensionId, id)) return false;
        const identity = await target.createCDPSession();
        try {
          return (
            (
              await identity.send("Target.getTargetInfo", undefined, {
                timeout: workerCommandTimeout,
              })
            ).targetInfo.targetId === openedTargetId
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
    completed = true;
    return panel;
  } finally {
    if (!completed)
      console.error(
        "パネルの開閉通知",
        await session.api
          .evaluate(`globalThis[${key}]?.opened ?? []`)
          .catch(() => []),
      );
    await session.api
      .evaluate(
        `(()=>{const state=globalThis[${key}];if(state){chrome.sidePanel.onOpened.removeListener(state.openListener);chrome.sidePanel.onClosed.removeListener(state.closeListener)}delete globalThis[${key}]})()`,
      )
      .catch(() => {});
    try {
      if (!completed && originalTargets) {
        // 起動途中で失敗しても、この操作が生成したパネルだけを回収する。
        const targets = await cdp.send("Target.getTargets", undefined, {
          timeout: workerCommandTimeout,
        });
        for (const target of targets.targetInfos) {
          if (
            !originalTargets.has(target.targetId) &&
            ownerTabId !== undefined &&
            isOwnedPanelUrl(target.url, extensionId, ownerTabId)
          ) {
            await cdp.send(
              "Target.closeTarget",
              { targetId: target.targetId },
              { timeout: workerCommandTimeout },
            );
            if (session.panelTargetId === target.targetId)
              session.panelTargetId = undefined;
          }
        }
      }
    } catch {
      // 起動失敗の原因を回収処理の失敗で上書きしない。
    } finally {
      await cdp.detach().catch((error) => {
        if (completed) throw error;
      });
    }
  }
}
