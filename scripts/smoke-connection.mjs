import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { LiveLoadGuard, liveSite } from "./compatibility/live-load.ts";
import {
  diagnosticMessage,
  observeConnectionWorker,
} from "./connection-diagnostics.ts";
import { loadDevCandidate } from "./dev-browser-candidate.ts";
import { createExtensionApiContext } from "./extension-api-context.ts";
import { launchDevBrowser } from "./managed-dev-browser.ts";

const loadGuard = new LiveLoadGuard();

if (process.argv.includes("--help")) {
  console.log(
    "使い方: pnpm run smoke:connection\n開発用Chromeで別サイト移動時の自動閉鎖、再接続、同一サイトの移動・再読込、タブごとのパネル独立性を検証します。作成したタブを閉じ、設定を復元します。結果: test-results/connection-smoke.json。失敗時は終了コード1。",
  );
  process.exit(0);
}
if (process.argv.length > 2) throw Error("引数は不要です");
const created = [],
  results = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  if (typeof client.evaluate === "function") return client.evaluate(expression);
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
let ownedBrowser, browser, api, backup, disposeWorkerDiagnostics;
let phase = "setup";
const panelEventsKey = `siftConnectionEvents:${randomUUID()}`;
const report = {
  date: new Date().toISOString(),
  method: "CDP Extensions.triggerAction (not a toolbar click)",
  pass: false,
  results,
  cleanupErrors: [],
  diagnostics: [],
};
function diagnose(kind, data) {
  if (report.diagnostics.length < 200)
    report.diagnostics.push({ time: Date.now(), phase, kind, ...data });
}
async function panelDiagnostics() {
  try {
    const events = await api.evaluate((key) => {
      const state = globalThis[key];
      return state ? state.events.splice(0) : [];
    }, panelEventsKey);
    for (const event of events) diagnose("panel-event", event);
  } catch (error) {
    diagnose("panel-observer-error", { message: diagnosticMessage(error) });
  }
}
async function connectionDiagnostics(page) {
  try {
    const state = await api.evaluate(async (tabId) => {
      const stored = await chrome.storage.session.get([
        `sift:sidepanel-origin:${tabId}`,
        `sift:sidepanel-page:${tabId}`,
      ]);
      const opening = stored[`sift:sidepanel-page:${tabId}`];
      return {
        options: await chrome.sidePanel.getOptions({ tabId }),
        savedOrigin: stored[`sift:sidepanel-origin:${tabId}`] ?? null,
        openingId: opening?.id ?? null,
        openingOrigin: opening?.url ? new URL(opening.url).origin : null,
      };
    }, page.tabId);
    diagnose("connection-state", { tabId: page.tabId, ...state });
  } catch (error) {
    diagnose("connection-state-error", { message: diagnosticMessage(error) });
  }
  await panelDiagnostics();
}
fs.mkdirSync("test-results", { recursive: true });
try {
  ownedBrowser = await launchDevBrowser(true);
  const candidate = await loadDevCandidate(ownedBrowser);
  report.candidate = {
    buildId: candidate.buildId,
    sha256: candidate.sha256,
    sourceHash: candidate.sourceHash,
  };
  const ext = candidate.loaded.id;
  browser = await ownedBrowser.target().createCDPSession();
  report.chrome = await browser.send("Browser.getVersion");
  await candidate.worker.dispose();
  api = await createExtensionApiContext(
    ownedBrowser.defaultBrowserContext(),
    ext,
  );
  disposeWorkerDiagnostics = await observeConnectionWorker(
    ownedBrowser,
    ext,
    diagnose,
  );
  await api.evaluate((key) => {
    const events = [];
    const capture = (kind) => (event) => {
      if (events.length < 100)
        events.push({
          time: Date.now(),
          event: kind,
          tabId: event.tabId ?? null,
        });
    };
    const opened = capture("opened");
    const closed = capture("closed");
    chrome.sidePanel.onOpened.addListener(opened);
    chrome.sidePanel.onClosed.addListener(closed);
    globalThis[key] = { events, opened, closed };
  }, panelEventsKey);
  const isPanel = (target) => {
    if (!URL.canParse(target.url())) return false;
    const url = new URL(target.url());
    return (
      url.protocol === "chrome-extension:" &&
      url.hostname === ext &&
      url.pathname === "/sidepanel.html"
    );
  };
  for (const target of ownedBrowser.targets().filter(isPanel)) {
    if (
      await (await target.asPage()).evaluate(
        () => document.visibilityState === "visible",
      )
    )
      throw Error("既存のsiftパネルを閉じてから実行してください");
  }
  backup = await evaluate(api, "chrome.storage.sync.get('settings')");
  fs.writeFileSync(
    `test-results/connection-settings-before-${(process.env.SIFT_LIVE_RUN_ID ?? new Date().toISOString()).replace(/[:.]/g, "-")}-${randomUUID()}.json`,
    JSON.stringify(backup, null, 2),
  );
  // 接続・権限の検証前に、保存済みの条件による追加取得を避ける。
  const unfiltered = structuredClone(backup.settings ?? { siteSettings: {} });
  unfiltered.siteSettings ??= {};
  for (const site of ["x", "bluesky"])
    unfiltered.siteSettings[site] = {
      ...unfiltered.siteSettings[site],
      minReactionsEnabled: false,
      mediaEnabled: false,
      mediaMode: "any",
      hideReplies: false,
      hideQuotes: false,
      hideReposts: false,
    };
  await api.evaluate(
    async (settings) => chrome.storage.sync.set({ settings }),
    unfiltered,
  );
  async function newPage(url) {
    loadGuard.setContext(
      "connection-smoke",
      `navigate-${liveSite(url) ?? "other"}`,
    );
    loadGuard.budget.assert(liveSite(url));
    const page = await ownedBrowser.newPage();
    created.push(page);
    await page.setCacheEnabled(true);
    await loadGuard.watch(page);
    const client = await page.createCDPSession();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await loadGuard.assertPage(page);
    const { targetInfo } = await client.send("Target.getTargetInfo");
    return { targetId: targetInfo.targetId, client, page, url };
  }
  async function activate(page) {
    await loadGuard.assertPage(page.page);
    await page.client.send("Page.bringToFront");
    page.tabId = await evaluate(
      api,
      "(async()=>{const ts=await chrome.tabs.query({active:true,lastFocusedWindow:true});return ts.length===1?ts[0].id:null;})()",
    );
    if (!Number.isInteger(page.tabId))
      throw Error("接続先タブIDを取得できません");
  }
  async function action(page) {
    phase = `action-${liveSite(page.url) ?? "other"}`;
    loadGuard.setContext(
      "connection-smoke",
      `action-${liveSite(page.url) ?? "other"}`,
    );
    await activate(page);
    await connectionDiagnostics(page);
    const { targetInfos } = await browser.send("Target.getTargets", {
      filter: [{ type: "tab" }, { exclude: true }],
    });
    const tabs = targetInfos.filter((t) => t.url === page.url);
    if (tabs.length !== 1)
      throw Error(`操作先タブを一意に特定できません: ${page.url}`);
    await browser.send("Extensions.triggerAction", {
      id: ext,
      targetId: tabs[0].targetId,
    });
    await connectionDiagnostics(page);
  }
  async function snapshot(page) {
    const panels = [];
    for (const target of ownedBrowser.targets().filter(isPanel)) {
      const panel = await target.asPage();
      panels.push(
        await panel.evaluate(async () => {
          const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          return {
            visibility: document.visibilityState,
            width: innerWidth,
            height: innerHeight,
            activeTabId: tabs.length === 1 ? tabs[0].id : null,
            ownerTabId: Number(
              new URL(location.href).searchParams.get("tabId"),
            ),
            text: document.body.innerText,
            site: document
              .querySelector("[data-sift-sidepanel]")
              ?.getAttribute("data-sift-site"),
            controls: document.querySelectorAll(
              "button[role=combobox],button[role=switch]",
            ).length,
          };
        }),
      );
    }
    return {
      url: await evaluate(page.client, "location.href"),
      width: await evaluate(page.client, "innerWidth"),
      tabId: page.tabId,
      panels,
    };
  }
  async function check(label, page, predicate, closedWidth) {
    phase = label;
    loadGuard.setContext("connection-smoke", label);
    await loadGuard.assertPage(page.page);
    let observation,
      stable = 0;
    for (let i = 0; i < 40; i++) {
      await delay(500);
      await loadGuard.assertPage(page.page);
      observation = await snapshot(page);
      const visible = observation.panels.filter(
        (p) => p.visibility === "visible" && p.width > 0 && p.height > 0,
      );
      stable =
        observation.url === page.url &&
        (closedWidth === undefined
          ? visible.length === 1 &&
            visible[0].activeTabId === page.tabId &&
            visible[0].ownerTabId === page.tabId &&
            predicate(visible[0])
          : visible.length === 0 && observation.width >= closedWidth - 2)
          ? stable + 1
          : 0;
      if (stable >= 3) {
        await connectionDiagnostics(page);
        results.push({ label, pass: true, ...observation });
        return;
      }
    }
    await connectionDiagnostics(page);
    results.push({ label, pass: false, ...observation });
    throw Error(`検証失敗: ${label}`);
  }
  const forSite = (site) => (p) =>
    p.site === site &&
    p.controls > 0 &&
    /最低いいね数|Minimum likes/.test(p.text);
  const x = forSite("x");
  const bluesky = forSite("bluesky");
  const first = await newPage("https://x.com/NASA");
  await delay(2000);
  const closedWidth = await evaluate(first.client, "innerWidth");
  await action(first);
  await check("Xプロフィールに接続", first, x);
  await first.page.reload({ waitUntil: "domcontentloaded" });
  await check("同じX一覧の再読込後に復旧", first, x);
  first.url = "https://bsky.app/profile/bsky.app";
  loadGuard.beginCase(first.page);
  loadGuard.setContext("connection-smoke-bluesky", "navigate-bluesky");
  await first.page.goto(first.url, { waitUntil: "domcontentloaded" });
  await check(
    "別サイトへの移動でパネルが閉じ、ページ幅が戻る",
    first,
    undefined,
    closedWidth,
  );
  await action(first);
  await check("明示アクションでBlueskyへ再接続", first, bluesky);
  await first.page.locator('::-p-aria([role="tab"][name="フィード"])').click();
  await check(
    "元の一覧を離れたら閉じ、ページ幅が戻る",
    first,
    undefined,
    closedWidth,
  );
  await first.page.locator('::-p-aria([role="tab"][name="投稿"])').click();
  await action(first);
  await check("明示アクションでBlueskyの投稿パネルを開く", first, bluesky);
  // 未開封タブへの切替ではパネルを引き継がず、開封済みタブへ戻ると復帰する。
  // プロフィール固有資源は最初のタブと共用する。
  const second = await newPage("https://x.com/NASA");
  await activate(second);
  await delay(2000);
  await check(
    "未開封の別タブへパネルを引き継がない",
    second,
    undefined,
    closedWidth,
  );
  await activate(first);
  await check("元のBlueskyタブでパネルが再表示される", first, bluesky);
  await action(second);
  await check("明示アクションで別タブのXパネルを開く", second, x);
  await activate(first);
  await check("Blueskyタブのパネル内容が保持される", first, bluesky);
  await activate(second);
  await check("Xタブの独立したパネルが再表示される", second, x);
  report.pass = true;
} catch (error) {
  report.error = String(error);
} finally {
  phase = "cleanup";
  if (api) {
    await panelDiagnostics();
    try {
      await api.evaluate((key) => {
        const state = globalThis[key];
        if (!state) return;
        chrome.sidePanel.onOpened.removeListener(state.opened);
        chrome.sidePanel.onClosed.removeListener(state.closed);
        delete globalThis[key];
      }, panelEventsKey);
    } catch (error) {
      diagnose("panel-observer-error", { message: diagnosticMessage(error) });
    }
  }
  await disposeWorkerDiagnostics?.();
  // 自分で作ったタブだけ閉じる。パネルを破棄してから設定を戻す。
  for (const page of created) {
    try {
      await page.close();
    } catch (error) {
      report.cleanupErrors.push(String(error));
    }
  }
  if (api && backup && created.every((page) => page.isClosed())) {
    try {
      await delay(500);
      await api.evaluate(async (saved) => {
        if (Object.hasOwn(saved, "settings"))
          await chrome.storage.sync.set(saved);
        else await chrome.storage.sync.remove("settings");
      }, backup);
      const restored = await api.evaluate(() =>
        chrome.storage.sync.get("settings"),
      );
      if (JSON.stringify(restored) !== JSON.stringify(backup))
        report.cleanupErrors.push("設定を復元できませんでした");
    } catch (error) {
      report.cleanupErrors.push(String(error));
    }
  }
  try {
    await api?.dispose();
    await browser?.detach();
  } catch (error) {
    report.cleanupErrors.push(String(error));
  }
  try {
    await ownedBrowser?.close();
  } catch (error) {
    report.cleanupErrors.push(String(error));
  }
  if (report.cleanupErrors.length) report.pass = false;
  fs.writeFileSync(
    "test-results/connection-smoke.json",
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
