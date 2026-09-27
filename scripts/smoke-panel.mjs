import { homedir } from "node:os";
import path from "node:path";
import { callFunction } from "./cdp-call.ts";
import { readDevBrowserEndpoint } from "./dev-browser-endpoint.ts";

const [url, ...rest] = process.argv.slice(2);
if (url === "--help") {
  console.log(
    "使い方: npm run smoke:panel -- <開発用Chromeで開いているページの完全URL>\n既存タブを使用し、準備起動→閉じる→開く→閉じるを検証します。設定の最低値は指定なしに戻ります。結果はJSON、失敗時は終了コード1です。",
  );
  process.exit(0);
}
if (!url || rest.length)
  throw Error("完全URLを1つ指定してください。--help で使い方を確認できます。");
new URL(url);
const endpoint = await readDevBrowserEndpoint(
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile"),
  9224,
);
if (!endpoint)
  throw Error(
    "開発用Chromeが未起動です。npm run browser:open を実行してください。",
  );
const base = endpoint.url,
  ext = "bohbpocokkfioejlabmeaimpkpmablkm";
const connections = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data),
      p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
  const c = {
    close: () => ws.close(),
    call: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => {
          pending.delete(n);
          reject(Error(`Timeout ${method}`));
        }, 8000);
        pending.set(n, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
  };
  connections.push(c);
  return c;
}
async function ev(c, expression) {
  const r = await c.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const targets = async () => await (await fetch(`${base}/json/list`)).json();
let worker;
try {
  const list = await targets();
  const wt = list.find(
    (t) =>
      t.type === "service_worker" &&
      t.url === `chrome-extension://${ext}/background.js`,
  );
  const pages = list.filter((t) => t.type === "page" && t.url === url);
  if (pages.length !== 1) throw Error("対象URLのタブを1つだけ開いてください");
  const pt = pages[0];
  if (!wt || !pt) throw Error("Required dedicated targets missing");
  worker = await connect(wt.webSocketDebuggerUrl);
  const page = await connect(pt.webSocketDebuggerUrl);
  const browser = await connect(endpoint.webSocketDebuggerUrl);
  await browser.call("Target.activateTarget", { targetId: pt.id });
  // 再起動直後は activeTab 権限がないため、準備としてアクションを実行する。
  const initialTabs = await browser.call("Target.getTargets", {
    filter: [{ type: "tab" }, { exclude: true }],
  });
  const initialTab = initialTabs.targetInfos.filter((t) => t.url === pt.url);
  if (initialTab.length !== 1) throw Error("Ambiguous preparation tab");
  await browser.call("Extensions.triggerAction", {
    id: ext,
    targetId: initialTab[0].targetId,
  });
  await pause(500);
  const tab = await callFunction(
    worker,
    "async function(url){const ts=await chrome.tabs.query({});const matches=ts.filter(t=>t.url===url);if(matches.length!==1)throw Error('Ambiguous tab');const t=matches[0];return {id:t.id,windowId:t.windowId,active:t.active};}",
    [pt.url],
  );
  await ev(
    worker,
    `(()=>{if(globalThis.__siftSmokeObserver)throw Error('Observer already exists');const s={events:[]};s.opened=info=>s.events.push({event:'opened',...info,time:Date.now()});s.closed=info=>s.events.push({event:'closed',...info,time:Date.now()});chrome.sidePanel.onOpened.addListener(s.opened);chrome.sidePanel.onClosed.addListener(s.closed);globalThis.__siftSmokeObserver=s;return true;})()`,
  );
  await callFunction(
    worker,
    "function(tabId){return chrome.sidePanel.close({tabId});}",
    [tab.id],
  );
  await pause(400);
  await ev(worker, "globalThis.__siftSmokeObserver.events.length=0");
  const baseline = await ev(
    page,
    "({width:innerWidth,height:innerHeight,visibility:document.visibilityState})",
  );
  const tabs = await browser.call("Target.getTargets", {
    filter: [{ type: "tab" }, { exclude: true }],
  });
  const tt = tabs.targetInfos.filter((t) => t.url === pt.url);
  if (tt.length !== 1) throw Error("Ambiguous CDP tab");
  await browser.call("Extensions.triggerAction", {
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
  for (const p of (await targets()).filter(
    (t) =>
      t.type === "page" && t.url === `chrome-extension://${ext}/sidepanel.html`,
  )) {
    const pc = await connect(p.webSocketDebuggerUrl);
    panelStates.push(
      await callFunction(
        pc,
        "async function(target){const s=await chrome.storage.session.get('sift:sidepanel-tab-id');return {target,visibility:document.visibilityState,width:innerWidth,height:innerHeight,tabId:s['sift:sidepanel-tab-id'],text:document.body.innerText};}",
        [p.id],
      ),
    );
  }
  await callFunction(
    worker,
    "function(tabId){return chrome.sidePanel.close({tabId});}",
    [tab.id],
  );
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
  if (worker)
    await ev(
      worker,
      `(()=>{const s=globalThis.__siftSmokeObserver;if(s){chrome.sidePanel.onOpened.removeListener(s.opened);chrome.sidePanel.onClosed.removeListener(s.closed);delete globalThis.__siftSmokeObserver;}return true;})()`,
    ).catch(() => {});
  for (const c of connections) c.close();
}
