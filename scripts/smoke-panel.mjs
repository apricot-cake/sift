import { loadDevCandidate } from "./dev-browser-candidate.ts";
import { launchDevBrowser } from "./managed-dev-browser.ts";

const [url, ...rest] = process.argv.slice(2);
if (url === "--help") {
  console.log(
    "使い方: npm run smoke:panel -- <ページの完全URL>\n同じURLの既存タブが1つあれば再利用し、なければ検証用タブを作ってページを読み込みます。2つ以上あれば失敗します。準備起動→閉じる→開く→閉じるを検証し、作成したタブだけを閉じて設定を復元します。結果はJSON、失敗時は終了コード1です。",
  );
  process.exit(0);
}
if (!url || rest.length)
  throw Error("完全URLを1つ指定してください。--help で使い方を確認できます。");
new URL(url);
let ownedBrowser, worker, backup, root, tab, createdPage;
const connections = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(c, expression) {
  if (typeof c.evaluate === "function") return c.evaluate(expression);
  const r = await c.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
try {
  ownedBrowser = await launchDevBrowser(true);
  const candidate = await loadDevCandidate(ownedBrowser);
  const ext = candidate.loaded.id;
  root = await ownedBrowser.target().createCDPSession();
  const browser = root;
  worker = candidate.worker;
  backup = await worker.evaluate(() => chrome.storage.sync.get("settings"));
  const pages = (await ownedBrowser.pages()).filter(
    (page) => page.url() === url,
  );
  if (pages.length > 1) throw Error("対象URLのタブを1つだけ開いてください");
  let selectedPage = pages[0];
  if (!selectedPage) {
    createdPage = await ownedBrowser.newPage();
    selectedPage = createdPage;
    await selectedPage.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  }
  const page = await selectedPage.createCDPSession();
  connections.push(page);
  const { targetInfo: pt } = await page.send("Target.getTargetInfo");
  await browser.send("Target.activateTarget", { targetId: pt.targetId });
  // 再起動直後は activeTab 権限がないため、準備としてアクションを実行する。
  const initialTabs = await browser.send("Target.getTargets", {
    filter: [{ type: "tab" }, { exclude: true }],
  });
  const initialTab = initialTabs.targetInfos.filter((t) => t.url === pt.url);
  if (initialTab.length !== 1) throw Error("Ambiguous preparation tab");
  await browser.send("Extensions.triggerAction", {
    id: ext,
    targetId: initialTab[0].targetId,
  });
  await pause(500);
  tab = await worker.evaluate(async (url) => {
    const matches = (await chrome.tabs.query({})).filter(
      (tab) => tab.url === url,
    );
    if (matches.length !== 1) throw Error("Ambiguous tab");
    const tab = matches[0];
    return { id: tab.id, windowId: tab.windowId, active: tab.active };
  }, pt.url);
  await ev(
    worker,
    `(()=>{if(globalThis.__siftSmokeObserver)throw Error('Observer already exists');const s={events:[]};s.opened=info=>s.events.push({event:'opened',...info,time:Date.now()});s.closed=info=>s.events.push({event:'closed',...info,time:Date.now()});chrome.sidePanel.onOpened.addListener(s.opened);chrome.sidePanel.onClosed.addListener(s.closed);globalThis.__siftSmokeObserver=s;return true;})()`,
  );
  await worker.evaluate((tabId) => chrome.sidePanel.close({ tabId }), tab.id);
  await waitEvent("closed");
  await pause(400);
  await ev(worker, "globalThis.__siftSmokeObserver.events.length=0");
  const baseline = await ev(
    page,
    "({width:innerWidth,height:innerHeight,visibility:document.visibilityState})",
  );
  const tabs = await browser.send("Target.getTargets", {
    filter: [{ type: "tab" }, { exclude: true }],
  });
  const tt = tabs.targetInfos.filter((t) => t.url === pt.url);
  if (tt.length !== 1) throw Error("Ambiguous CDP tab");
  await browser.send("Extensions.triggerAction", {
    id: ext,
    targetId: tt[0].targetId,
  });
  async function waitEvent(name) {
    for (let i = 0; i < 50; i++) {
      const events = await ev(worker, "globalThis.__siftSmokeObserver.events");
      const found = events.find(
        (e) =>
          e.event === name &&
          e.tabId === tab.id &&
          e.windowId === tab.windowId &&
          e.path.replace(/^\//, "") === "sidepanel.html",
      );
      if (found) return events;
      await pause(100);
    }
    console.log(
      JSON.stringify({
        tab,
        events: await ev(worker, "globalThis.__siftSmokeObserver.events"),
        viewport: await ev(page, "({width:innerWidth,height:innerHeight})"),
      }),
    );
    throw Error(`Missing matching ${name}`);
  }
  const opened = await waitEvent("opened");
  await pause(500);
  const openPage = await ev(
    page,
    "({width:innerWidth,height:innerHeight,visibility:document.visibilityState})",
  );
  const panelStates = [];
  for (const target of ownedBrowser
    .targets()
    .filter(
      (target) => target.url() === `chrome-extension://${ext}/sidepanel.html`,
    )) {
    const panel = await target.asPage();
    const pc = await panel.createCDPSession();
    connections.push(pc);
    const { targetInfo } = await pc.send("Target.getTargetInfo");
    panelStates.push(
      await panel.evaluate(async (target) => {
        const state = await chrome.storage.session.get("sift:sidepanel-tab-id");
        return {
          target,
          visibility: document.visibilityState,
          width: innerWidth,
          height: innerHeight,
          tabId: state["sift:sidepanel-tab-id"],
          text: document.body.innerText,
        };
      }, targetInfo.targetId),
    );
  }
  await worker.evaluate((tabId) => chrome.sidePanel.close({ tabId }), tab.id);
  const closed = await waitEvent("closed");
  await pause(500);
  const closedPage = await ev(
    page,
    "({width:innerWidth,height:innerHeight,visibility:document.visibilityState})",
  );
  const result = {
    url,
    method: "CDP Extensions.triggerAction (not a toolbar click)",
    tab,
    baseline,
    opened,
    openPage,
    panelStates,
    closed,
    closedPage,
    pass:
      opened.length === 1 &&
      closed.length === 2 &&
      openPage.width < baseline.width &&
      closedPage.width === baseline.width &&
      panelStates.some(
        (p) =>
          p.visibility === "visible" &&
          p.tabId === tab.id &&
          p.width > 0 &&
          p.height > 0 &&
          p.text.trim().length > 0,
      ),
  };
  if (!result.pass) process.exitCode = 1;
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (worker && tab) {
    await worker
      .evaluate((tabId) => chrome.sidePanel.close({ tabId }), tab.id)
      .catch(() => {});
    await pause(500);
  }
  if (worker)
    await ev(
      worker,
      `(()=>{const s=globalThis.__siftSmokeObserver;if(s){chrome.sidePanel.onOpened.removeListener(s.opened);chrome.sidePanel.onClosed.removeListener(s.closed);delete globalThis.__siftSmokeObserver;}return true;})()`,
    ).catch(() => {});
  try {
    if (worker && backup) {
      await worker.evaluate(async (saved) => {
        if (Object.hasOwn(saved, "settings"))
          await chrome.storage.sync.set(saved);
        else await chrome.storage.sync.remove("settings");
      }, backup);
      const restored = await worker.evaluate(() =>
        chrome.storage.sync.get("settings"),
      );
      if (JSON.stringify(restored) !== JSON.stringify(backup)) {
        process.exitCode = 1;
        console.error("設定を復元できませんでした");
      }
    }
  } finally {
    try {
      try {
        await createdPage?.close();
      } finally {
        await worker?.dispose();
        for (const c of connections) await c.detach().catch(() => {});
        await root?.detach().catch(() => {});
      }
    } finally {
      await ownedBrowser?.close();
    }
  }
}
