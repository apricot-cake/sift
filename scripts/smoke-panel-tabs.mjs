import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { getExtensionWorker } from "./browser-worker.ts";
import { LiveLoadGuard } from "./compatibility/live-load.ts";
import { loadDevCandidate } from "./dev-browser-candidate.ts";
import { createExtensionApiContext } from "./extension-api-context.ts";
import { launchDevBrowser } from "./managed-dev-browser.ts";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const guard = new LiveLoadGuard();
const pages = [];
const report = {
  date: new Date().toISOString(),
  method: "Headless Chrome pipe / CDP Extensions.triggerAction",
  pass: false,
  results: [],
  cleanupErrors: [],
};
const legacyGlobal = process.env.SIFT_SMOKE_LEGACY_GLOBAL === "1";
let browser, root, api, backup, globalBackup, worker, ext, lifecycle;
fs.mkdirSync("test-results", { recursive: true });
try {
  browser = await launchDevBrowser(true);
  const candidate = await loadDevCandidate(browser);
  report.candidate = {
    buildId: candidate.buildId,
    sha256: candidate.sha256,
    ...candidate.loaded,
  };
  worker = candidate.worker;
  ext = candidate.loaded.id;
  root = await browser.target().createCDPSession();
  report.chrome = await root.send("Browser.getVersion");
  api = await createExtensionApiContext(browser.defaultBrowserContext(), ext);
  globalBackup = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
  if (legacyGlobal) {
    await worker.evaluate(() => chrome.sidePanel.setOptions({ enabled: true }));
    report.legacyGlobalSeeded = await worker.evaluate(() =>
      chrome.sidePanel.getOptions({}),
    );
    const diagnosticPage = (await browser.pages()).find(
      (page) => page.url() === `chrome-extension://${ext}/manifest.json`,
    );
    if (!diagnosticPage) throw Error("worker監視用ページがありません");
    lifecycle = await diagnosticPage.createCDPSession();
    const versions = new Map();
    lifecycle.on(
      "ServiceWorker.workerVersionUpdated",
      ({ versions: updates }) => {
        for (const version of updates) versions.set(version.versionId, version);
      },
    );
    await lifecycle.send("ServiceWorker.enable");
    let version;
    for (let attempt = 0; attempt < 30; attempt++) {
      version = [...versions.values()].find(
        (item) =>
          item.scriptURL === `chrome-extension://${ext}/background.js` &&
          item.runningStatus === "running",
      );
      if (version) break;
      await delay(100);
    }
    if (!version) throw Error("稼働中workerのversionIdを取得できません");
    const previousTargetId = worker.targetId;
    await worker.dispose();
    worker = undefined;
    await lifecycle.send("ServiceWorker.stopWorker", {
      versionId: version.versionId,
    });
    await api.evaluate(() =>
      chrome.runtime
        .sendMessage({ type: "sift:smoke-wake" })
        .catch(() => undefined),
    );
    worker = await getExtensionWorker(browser, ext, 10000, previousTargetId);
    report.workerRestart = {
      previousTargetId,
      targetId: worker.targetId,
      stoppedVersionId: version.versionId,
      method: "ServiceWorker.stopWorker + runtime.sendMessage",
    };
    if (worker.targetId === previousTargetId)
      throw Error("workerの入れ替わりを確認できません");
  }
  if (legacyGlobal) {
    for (let attempt = 0; attempt < 30; attempt++) {
      report.globalAfterWorkerRestart = await api.evaluate(() =>
        chrome.sidePanel.getOptions({}),
      );
      report.restartedBuildId = await worker.evaluate(
        () => globalThis.__SIFT_RUNNING_BUILD_ID__ ?? null,
      );
      if (
        report.globalAfterWorkerRestart.enabled === false &&
        report.restartedBuildId === candidate.buildId
      )
        break;
      await delay(100);
    }
    if (
      report.globalAfterWorkerRestart.enabled !== false ||
      report.restartedBuildId !== candidate.buildId
    )
      throw Error(
        "worker再起動後に全体パネルの無効化と候補ビルドを確認できません",
      );
  }
  await worker.dispose();
  worker = undefined;
  backup = await api.evaluate(() => chrome.storage.sync.get("settings"));
  fs.writeFileSync(
    `test-results/panel-tabs-settings-before-${randomUUID()}.json`,
    JSON.stringify(backup, null, 2),
  );
  const unfiltered = structuredClone(backup.settings ?? { siteSettings: {} });
  unfiltered.siteSettings ??= {};
  for (const site of ["x", "bluesky"])
    unfiltered.siteSettings[site] = {
      ...unfiltered.siteSettings[site],
      kind: "reactions",
      minReactionsEnabled: false,
      mediaEnabled: false,
      mediaMode: "any",
      hideReplies: false,
      hideQuotes: false,
      hideReposts: false,
    };
  unfiltered.siteSettings.youtube = { kind: "metric" };
  await api.evaluate(
    (settings) => chrome.storage.sync.set({ settings }),
    unfiltered,
  );

  async function create(url) {
    guard.setContext("panel-tabs-smoke", "navigate");
    const page = await browser.newPage();
    pages.push(page);
    await guard.watch(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await guard.assertPage(page);
    const client = await page.createCDPSession();
    return { page, client, url };
  }
  async function activate(target) {
    await target.client.send("Page.bringToFront");
    await delay(500);
    target.tabId = await api.evaluate(async () => {
      const tabs = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (tabs.length !== 1) throw Error("アクティブタブが一意ではありません");
      return tabs[0].id;
    });
  }
  async function action(target) {
    await activate(target);
    const { targetInfos } = await root.send("Target.getTargets", {
      filter: [{ type: "tab" }, { exclude: true }],
    });
    const tabs = targetInfos.filter((tab) => tab.url === target.url);
    if (tabs.length !== 1) throw Error("操作先タブが一意ではありません");
    await root.send("Extensions.triggerAction", {
      id: ext,
      targetId: tabs[0].targetId,
    });
  }
  async function snapshot(target) {
    const panels = [];
    for (const item of browser.targets()) {
      if (!item.url().startsWith(`chrome-extension://${ext}/sidepanel.html`))
        continue;
      const page = await item.asPage();
      if (!page) continue;
      panels.push(
        await page.evaluate(() => ({
          visibility: document.visibilityState,
          width: innerWidth,
          height: innerHeight,
          ownerTabId: new URL(location.href).searchParams.has("tabId")
            ? Number(new URL(location.href).searchParams.get("tabId"))
            : null,
          text: document.body.innerText,
        })),
      );
    }
    return {
      tabId: target.tabId,
      url: target.url,
      globalOptions: await api.evaluate(() => chrome.sidePanel.getOptions({})),
      tabOptions: await api.evaluate(
        (tabId) => chrome.sidePanel.getOptions({ tabId }),
        target.tabId,
      ),
      width: await target.page.evaluate(() => innerWidth),
      panels,
    };
  }
  async function check(label, target, open) {
    guard.setContext("panel-tabs-smoke", label);
    let state,
      stable = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      await delay(250);
      await guard.assertPage(target.page);
      state = await snapshot(target);
      const visible = state.panels.filter(
        (panel) =>
          panel.visibility === "visible" && panel.width > 0 && panel.height > 0,
      );
      const matches = open
        ? visible.length === 1 &&
          visible[0].ownerTabId === target.tabId &&
          visible[0].text.trim().length > 0 &&
          state.width < target.closedWidth - 20
        : visible.length === 0 &&
          Math.abs(state.width - target.closedWidth) <= 2;
      stable = matches ? stable + 1 : 0;
      if (stable >= 3) break;
    }
    const pass = stable >= 3;
    report.results.push({ label, expectedOpen: open, pass, ...state });
    if (!pass) throw Error(`検証失敗: ${label}`);
  }
  const youtube = await create("https://www.youtube.com/@Google/videos");
  const x = await create("https://x.com/NASA");
  const other = await create("https://example.com/");
  for (const target of [youtube, x, other]) {
    await activate(target);
    target.closedWidth = await target.page.evaluate(() => innerWidth);
    await check("起動前の閉鎖状態", target, false);
  }
  await action(youtube);
  await check("YouTubeで明示的に開く", youtube, true);
  for (let cycle = 1; cycle <= 2; cycle++) {
    for (const target of [x, other]) {
      await activate(target);
      await check(`往復${cycle}:未開封タブは閉じたまま`, target, false);
      await activate(youtube);
      await check(`往復${cycle}:YouTubeへ復帰`, youtube, true);
      await activate(target);
      await check(`往復${cycle}:復帰後も別タブは閉じたまま`, target, false);
    }
  }
  await action(other);
  await check("対象外タブを明示的に開く", other, true);
  await api.evaluate((tabId) => chrome.sidePanel.close({ tabId }), other.tabId);
  await check("対象外タブを明示的に閉じる", other, false);
  await activate(youtube);
  await check("別タブ閉鎖後もYouTubeを復元", youtube, true);
  await activate(other);
  await check("閉じた別タブを再表示しても開き直さない", other, false);
  report.pass = true;
} catch (error) {
  report.error = String(error);
} finally {
  if (!api && browser && ext && globalBackup) {
    api = await createExtensionApiContext(
      browser.defaultBrowserContext(),
      ext,
    ).catch((error) => {
      report.cleanupErrors.push(String(error));
      return undefined;
    });
  }
  for (const page of pages)
    await page
      .close()
      .catch((error) => report.cleanupErrors.push(String(error)));
  if (api && backup && pages.every((page) => page.isClosed())) {
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
      report.settingsRestored =
        JSON.stringify(restored) === JSON.stringify(backup);
      if (!report.settingsRestored)
        report.cleanupErrors.push("設定の復元に失敗しました");
    } catch (error) {
      report.cleanupErrors.push(String(error));
    }
  }
  if (api && globalBackup) {
    await api
      .evaluate((options) => chrome.sidePanel.setOptions(options), globalBackup)
      .catch((error) => report.cleanupErrors.push(String(error)));
  }
  await worker
    ?.dispose()
    .catch((error) => report.cleanupErrors.push(String(error)));
  await lifecycle
    ?.detach()
    .catch((error) => report.cleanupErrors.push(String(error)));
  await api
    ?.dispose()
    .catch((error) => report.cleanupErrors.push(String(error)));
  await root
    ?.detach()
    .catch((error) => report.cleanupErrors.push(String(error)));
  await browser
    ?.close()
    .catch((error) => report.cleanupErrors.push(String(error)));
  if (report.cleanupErrors.length) report.pass = false;
  fs.writeFileSync(
    legacyGlobal
      ? "test-results/panel-tabs-smoke-legacy-global.json"
      : "test-results/panel-tabs-smoke.json",
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
