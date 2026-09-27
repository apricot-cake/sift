import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readDevBrowserEndpoint } from "./dev-browser-endpoint.ts";

if (process.argv.includes("--help")) {
  console.log(
    "使い方: npm run smoke:connection\n開発用ChromeでX→YouTubeの権限喪失、再接続、再読込、タブ切替を検証します。作成したタブを閉じ、設定を復元します。結果: test-results/connection-smoke.json。失敗時は終了コード1。",
  );
  process.exit(0);
}
if (process.argv.length > 2) throw Error("引数は不要です");
const endpoint = await readDevBrowserEndpoint(
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile"),
  9224,
);
if (!endpoint)
  throw Error("npm run browser:open で開発用Chromeを起動してください");
const ext = "bohbpocokkfioejlabmeaimpkpmablkm";
const connections = [],
  created = [],
  results = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const targets = async () => (await fetch(`${endpoint.url}/json/list`)).json();
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data),
      item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    message.error
      ? item.reject(Error(JSON.stringify(message.error)))
      : item.resolve(message.result);
  };
  const client = {
    close: () => socket.close(),
    call: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => {
          pending.delete(n);
          reject(Error(`${method}: timeout`));
        }, 10000);
        pending.set(n, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: n, method, params }));
      }),
  };
  connections.push(client);
  return client;
}
async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
let browser, worker, backup;
const report = {
  date: new Date().toISOString(),
  method: "CDP Extensions.triggerAction (not a toolbar click)",
  pass: false,
  results,
  cleanupErrors: [],
};
fs.mkdirSync("test-results", { recursive: true });
try {
  browser = await connect(endpoint.webSocketDebuggerUrl);
  report.chrome = await browser.call("Browser.getVersion");
  const wt = (await targets()).find(
    (t) =>
      t.type === "service_worker" &&
      t.url === `chrome-extension://${ext}/background.js`,
  );
  if (!wt) throw Error("Siftのバックグラウンドが見つかりません");
  worker = await connect(wt.webSocketDebuggerUrl);
  // 既存の表示中パネルを閉じたり、接続先を変更したりしない。
  for (const t of (await targets()).filter(
    (t) => t.url === `chrome-extension://${ext}/sidepanel.html`,
  )) {
    if (
      await evaluate(
        await connect(t.webSocketDebuggerUrl),
        'document.visibilityState === "visible"',
      )
    )
      throw Error("既存のSiftパネルを閉じてから実行してください");
  }
  backup = await evaluate(worker, "chrome.storage.sync.get('settings')");
  fs.writeFileSync(
    "test-results/connection-settings-before.json",
    JSON.stringify(backup, null, 2),
  );
  async function newPage(url) {
    const { targetId } = await browser.call("Target.createTarget", { url });
    created.push(targetId);
    const t = (await targets()).find((t) => t.id === targetId);
    return { targetId, client: await connect(t.webSocketDebuggerUrl), url };
  }
  async function action(page) {
    await page.client.call("Page.bringToFront");
    const { targetInfos } = await browser.call("Target.getTargets", {
      filter: [{ type: "tab" }, { exclude: true }],
    });
    const tabs = targetInfos.filter((t) => t.url === page.url);
    if (tabs.length !== 1)
      throw Error(`操作先タブを一意に特定できません: ${page.url}`);
    await browser.call("Extensions.triggerAction", {
      id: ext,
      targetId: tabs[0].targetId,
    });
    page.tabId = await evaluate(
      worker,
      "(async()=>{const ts=await chrome.tabs.query({active:true,lastFocusedWindow:true});return ts.length===1?ts[0].id:null;})()",
    );
    if (!Number.isInteger(page.tabId))
      throw Error("接続先タブIDを取得できません");
  }
  const panelClients = new Map();
  async function snapshot(page) {
    const panels = [];
    for (const t of (await targets()).filter(
      (t) => t.url === `chrome-extension://${ext}/sidepanel.html`,
    )) {
      if (!panelClients.has(t.id))
        panelClients.set(t.id, await connect(t.webSocketDebuggerUrl));
      panels.push(
        await evaluate(
          panelClients.get(t.id),
          `(async()=>{const ts=await chrome.tabs.query({active:true,currentWindow:true});return {visibility:document.visibilityState,width:innerWidth,height:innerHeight,activeTabId:ts.length===1?ts[0].id:null,text:document.body.innerText,controls:document.querySelectorAll('button[role=combobox],button[role=switch]').length};})()`,
        ),
      );
    }
    return {
      url: await evaluate(page.client, "location.href"),
      tabId: page.tabId,
      panels,
    };
  }
  async function check(label, page, predicate) {
    let observation,
      stable = 0;
    for (let i = 0; i < 40; i++) {
      await delay(500);
      observation = await snapshot(page);
      const visible = observation.panels.filter(
        (p) =>
          p.visibility === "visible" &&
          p.width > 0 &&
          p.height > 0 &&
          p.activeTabId === page.tabId,
      );
      stable =
        observation.url === page.url &&
        visible.length === 1 &&
        predicate(visible[0])
          ? stable + 1
          : 0;
      if (stable >= 3) {
        results.push({ label, pass: true, ...observation });
        return;
      }
    }
    results.push({ label, pass: false, ...observation });
    throw Error(`検証失敗: ${label}`);
  }
  const x = (p) => p.controls > 0 && /最低いいね数|Minimum likes/.test(p.text);
  const youtube = (p) =>
    p.controls > 0 && /最低再生回数|Minimum views/.test(p.text);
  const first = await newPage("https://x.com/uowata94");
  await delay(2000);
  await action(first);
  await check("Xプロフィールに接続", first, x);
  first.url = "https://www.youtube.com/@Google/videos";
  await first.client.call("Page.navigate", { url: first.url });
  await check(
    "権限喪失時は対象外ではなく接続案内",
    first,
    (p) =>
      p.controls === 0 &&
      /接続できていません|Not connected to this page/.test(p.text) &&
      /ツールバー|toolbar/.test(p.text) &&
      !/このページではフィルターを使えません/.test(p.text),
  );
  await action(first);
  await check("アクション後にYouTubeへ再接続", first, youtube);
  await first.client.call("Page.reload");
  await check("再読込後に復旧", first, youtube);
  const second = await newPage("https://x.com/AdamasMC");
  await delay(2000);
  await action(second);
  await check("別タブのXへ接続", second, x);
  await first.client.call("Page.bringToFront");
  await check("元のYouTubeタブに追従", first, youtube);
  report.pass = true;
} catch (error) {
  report.error = String(error);
} finally {
  // 自分で作ったタブだけ閉じる。パネルを破棄してから設定を戻す。
  for (const targetId of created) {
    try {
      await browser.call("Target.closeTarget", { targetId });
    } catch (error) {
      report.cleanupErrors.push(String(error));
    }
  }
  if (worker && backup) {
    try {
      await delay(500);
      await evaluate(
        worker,
        Object.hasOwn(backup, "settings")
          ? `chrome.storage.sync.set(${JSON.stringify(backup)})`
          : "chrome.storage.sync.remove('settings')",
      );
    } catch (error) {
      report.cleanupErrors.push(String(error));
    }
  }
  for (const client of connections) client.close();
  if (report.cleanupErrors.length) report.pass = false;
  fs.writeFileSync(
    "test-results/connection-smoke.json",
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
