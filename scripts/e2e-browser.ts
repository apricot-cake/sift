// 実在の公開ページを専用 Chrome で開き、action 経由で Sift を注入する。
// ページの内容を作ったり書き換えたりしない。投稿ごとの境界値は whitebox テストで
// 固定し、ここではブラウザ、拡張機能、同期設定、実ページの接続を確かめる。
import { defaults, type Settings } from "../utils/settings.ts";
import {
  type DevBrowserEndpoint,
  readDevBrowserEndpoint,
} from "./dev-browser-endpoint.ts";

const EXTENSION_ID = "bohbpocokkfioejlabmeaimpkpmablkm";
const PROFILE =
  process.env.SIFT_DEV_PROFILE ??
  `${process.env.USERPROFILE ?? process.env.HOME ?? ""}\\.sift-ext-profile`;
const FILTER_CONTEXT_REQUEST = "sift:get-filter-context";
const SET_FILTERING = "sift:timeline-set-filtering";
const SESSION_STORAGE_PROBE_KEY = "sift:e2e-session-storage-probe";

interface CdpTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

interface CdpTargetInfo {
  readonly targetId: string;
  readonly type: string;
  readonly url: string;
}

interface FilterContext {
  readonly site: string;
  readonly timelineAvailable: boolean;
  readonly filteringEnabled: boolean;
}

interface PageCase {
  readonly label: string;
  readonly url: string;
  readonly available: boolean;
  readonly site: keyof Settings["siteSettings"];
}

const PAGE_CASES: readonly PageCase[] = [
  {
    label: "X のホーム（フォロー中）",
    url: "https://x.com/home",
    available: true,
    site: "x",
  },
  {
    label: "X の設定",
    url: "https://x.com/settings/account",
    available: false,
    site: "x",
  },
  {
    label: "Bluesky のホーム",
    url: "https://bsky.app/",
    available: true,
    site: "bluesky",
  },
  {
    label: "Bluesky の設定",
    url: "https://bsky.app/settings",
    available: false,
    site: "bluesky",
  },
  {
    label: "YouTube の検索結果",
    url: "https://www.youtube.com/results?search_query=Chrome",
    available: true,
    site: "youtube",
  },
  {
    label: "YouTube の視聴ページ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    available: false,
    site: "youtube",
  },
  {
    label: "ニコニコ動画の検索結果",
    url: "https://www.nicovideo.jp/search/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF",
    available: true,
    site: "niconico",
  },
  {
    label: "ニコニコ動画の視聴ページ",
    url: "https://www.nicovideo.jp/watch/sm9",
    available: false,
    site: "niconico",
  },
];

// クリーンな CI プロファイルには日常サイトのログイン状態を持ち込まない。
// 認証不要で実在の一覧と詳細ページを提供する YouTube だけを、CI のブラウザ
// E2E と画面証跡の対象にする。全サイトの接続診断は開発用プロファイルで行う。
const pageCases =
  process.env.SIFT_E2E_MODE === "ci"
    ? PAGE_CASES.filter((page) => page.site === "youtube")
    : PAGE_CASES;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftEntries = Object.entries(left as Record<string, unknown>).sort(
    ([leftKey], [rightKey]) => leftKey.localeCompare(rightKey),
  );
  const rightEntries = Object.entries(right as Record<string, unknown>).sort(
    ([leftKey], [rightKey]) => leftKey.localeCompare(rightKey),
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        key === rightEntries[index]?.[0] &&
        sameJson(value, rightEntries[index]?.[1]),
    )
  );
}

async function cdpCall<T>(
  webSocketDebuggerUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP ${method} が時間内に応答しなかった。`));
    }, 10_000);
    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      socket.close();
      callback();
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      if (message.error) {
        finish(() => reject(new Error(message.error.message ?? method)));
      } else {
        finish(() => resolve(message.result as T));
      }
    });
    socket.addEventListener("error", () => {
      finish(() => reject(new Error(`CDP ${method} の接続に失敗した。`)));
    });
  });
}

async function targets(version: DevBrowserEndpoint): Promise<CdpTarget[]> {
  const response = await fetch(`${version.url}/json/list`);
  if (!response.ok) throw new Error("CDP のターゲット一覧を読めなかった。");
  return (await response.json()) as CdpTarget[];
}

async function extensionWorker(
  version: DevBrowserEndpoint,
): Promise<CdpTarget> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const worker = (await targets(version)).find(
      (target) =>
        target.type === "service_worker" &&
        target.url.startsWith(`chrome-extension://${EXTENSION_ID}/`),
    );
    if (worker) return worker;
    await delay(250);
  }
  throw new Error("Sift の service worker を CDP で見つけられなかった。");
}

async function evaluateExtension<T>(
  version: DevBrowserEndpoint,
  expression: string,
): Promise<T> {
  const worker = await extensionWorker(version);
  const result = await cdpCall<{
    result: { value?: T; description?: string };
    exceptionDetails?: { text?: string };
  }>(worker.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.text ?? "拡張機能の評価に失敗した。",
    );
  }
  return result.result.value as T;
}

async function pageTarget(
  version: DevBrowserEndpoint,
  url: string,
): Promise<CdpTarget> {
  const response = await fetch(
    `${version.url}/json/new?${encodeURIComponent(url)}`,
    {
      method: "PUT",
    },
  );
  if (!response.ok) throw new Error(`${url} を開けなかった。`);
  return (await response.json()) as CdpTarget;
}

async function wakeExtension(version: DevBrowserEndpoint): Promise<void> {
  const target = await pageTarget(
    version,
    "https://www.youtube.com/results?search_query=Chrome",
  );
  await delay(1_000);
  const listed = await cdpCall<{ targetInfos: CdpTargetInfo[] }>(
    version.webSocketDebuggerUrl,
    "Target.getTargets",
    { filter: [{ type: "tab", exclude: false }, { exclude: true }] },
  );
  const tab = listed.targetInfos.find(
    (candidate) => candidate.type === "tab" && candidate.url === target.url,
  );
  if (!tab) {
    const available = listed.targetInfos
      .filter((candidate) => candidate.type === "tab")
      .map((candidate) => candidate.url)
      .join(", ");
    throw new Error(
      `Sift を起動するためのタブを特定できなかった: ${target.url} (${available})`,
    );
  }
  await cdpCall(version.webSocketDebuggerUrl, "Extensions.triggerAction", {
    id: EXTENSION_ID,
    targetId: tab.targetId,
  });
}

async function waitForPanelDefaultSetup(
  version: DevBrowserEndpoint,
): Promise<void> {
  // Extensions.loadUnpacked の直後は onInstalled による既定値設定が非同期で
  // 走る。実際の利用ではインストール完了後に操作するため、CI も同じ状態から
  // action を実行する。
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const options = await evaluateExtension<{ enabled?: boolean }>(
      version,
      "chrome.sidePanel.getOptions({})",
    );
    if (options.enabled === false) return;
    await delay(250);
  }
  throw new Error("サイドパネルの初期設定が完了しなかった。");
}

async function tabIdForTarget(
  version: DevBrowserEndpoint,
  target: CdpTarget,
): Promise<number> {
  const listed = await cdpCall<{ targetInfos: CdpTargetInfo[] }>(
    version.webSocketDebuggerUrl,
    "Target.getTargets",
    { filter: [{ type: "tab", exclude: false }, { exclude: true }] },
  );
  const tab = listed.targetInfos.find(
    (candidate) => candidate.type === "tab" && candidate.url === target.url,
  );
  if (!tab) throw new Error(`${target.url} のタブを特定できなかった。`);
  await cdpCall(version.webSocketDebuggerUrl, "Target.activateTarget", {
    targetId: tab.targetId,
  });
  const id = await evaluateExtension<number | null>(
    version,
    "chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.id ?? null)",
  );
  if (id === null)
    throw new Error(`${target.url} の拡張機能タブ ID を得られなかった。`);
  await cdpCall(version.webSocketDebuggerUrl, "Extensions.triggerAction", {
    id: EXTENSION_ID,
    targetId: tab.targetId,
  });
  return id;
}

async function readContext(
  version: DevBrowserEndpoint,
  tabId: number,
): Promise<FilterContext | null> {
  return await evaluateExtension<FilterContext | null>(
    version,
    `chrome.tabs.sendMessage(${tabId}, { type: ${JSON.stringify(FILTER_CONTEXT_REQUEST)} }).catch(() => null)`,
  );
}

async function waitForContext(
  version: DevBrowserEndpoint,
  tabId: number,
): Promise<FilterContext | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const context = await readContext(version, tabId);
    if (context) return context;
    await delay(500);
  }
  return null;
}

async function setSettings(
  version: DevBrowserEndpoint,
  settings: Settings,
): Promise<Settings> {
  const encoded = JSON.stringify(settings);
  return await evaluateExtension<Settings>(
    version,
    `chrome.storage.sync.set({ settings: ${encoded} }).then(() => chrome.storage.sync.get("settings")).then(({ settings }) => settings)`,
  );
}

async function currentSettings(version: DevBrowserEndpoint): Promise<Settings> {
  return await evaluateExtension<Settings>(
    version,
    `chrome.storage.sync.get("settings").then(({ settings }) => settings ?? ${JSON.stringify(defaults)})`,
  );
}

async function verifySessionStorage(
  version: DevBrowserEndpoint,
): Promise<void> {
  const probe = "ready";
  const read = await evaluateExtension<string | null>(
    version,
    `chrome.storage.session.set({ ${JSON.stringify(SESSION_STORAGE_PROBE_KEY)}: ${JSON.stringify(probe)} }).then(() => chrome.storage.session.get(${JSON.stringify(SESSION_STORAGE_PROBE_KEY)})).then((stored) => stored[${JSON.stringify(SESSION_STORAGE_PROBE_KEY)}] ?? null)`,
  );
  await evaluateExtension<void>(
    version,
    `chrome.storage.session.remove(${JSON.stringify(SESSION_STORAGE_PROBE_KEY)})`,
  );
  if (read !== probe) {
    throw new Error("サイドパネル用の session storage を使えない。");
  }
}

async function settingsCombinations(
  version: DevBrowserEndpoint,
  site: PageCase["site"],
): Promise<void> {
  const base = structuredClone(defaults) as Settings;
  const cases: Settings[] =
    site === "x" || site === "bluesky"
      ? [
          {
            ...base,
            siteSettings: {
              ...base.siteSettings,
              [site]: {
                ...base.siteSettings[site],
                minReactionsEnabled: false,
                mediaEnabled: false,
                hideReplies: false,
                hideQuotes: false,
                hideReposts: false,
              },
            },
          },
          ...(["any", "images", "video"] as const).map((mediaMode) => ({
            ...base,
            siteSettings: {
              ...base.siteSettings,
              [site]: {
                ...base.siteSettings[site],
                minReactionsEnabled: true,
                minReactions: 1,
                mediaEnabled: true,
                mediaMode,
                hideReplies: true,
                hideQuotes: true,
                hideReposts: true,
              },
            },
          })),
        ]
      : [
          {
            ...base,
            siteSettings: {
              ...base.siteSettings,
              [site]: {
                ...base.siteSettings[site],
                minCountEnabled: false,
                hidePublishedWithinEnabled: false,
              },
            },
          },
          ...(["hour", "day", "week", "month", "year"] as const).map(
            (hidePublishedWithinUnit) => ({
              ...base,
              siteSettings: {
                ...base.siteSettings,
                [site]: {
                  ...base.siteSettings[site],
                  minCountEnabled: true,
                  minCount: 1,
                  hidePublishedWithinEnabled: true,
                  hidePublishedWithinValue: 1,
                  hidePublishedWithinUnit,
                },
              },
            }),
          ),
        ];

  if (site === "youtube") {
    cases.push({
      ...base,
      siteSettings: {
        ...base.siteSettings,
        youtube: {
          ...base.siteSettings.youtube,
          hideMembersOnly: true,
        },
      },
    });
  }

  for (const candidate of cases) {
    const saved = await setSettings(version, candidate);
    if (!sameJson(saved.siteSettings[site], candidate.siteSettings[site])) {
      throw new Error(`${site} の設定が同期ストレージへ保存されなかった。`);
    }
  }
}

interface FilterStateInspection {
  readonly cards: number;
  readonly filterStates: number;
  readonly visibility: string;
}

async function visibleFilterState(
  target: CdpTarget,
): Promise<FilterStateInspection> {
  let latest: FilterStateInspection = {
    cards: 0,
    filterStates: 0,
    visibility: "unknown",
  };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await cdpCall<{
      result: { value?: FilterStateInspection };
    }>(target.webSocketDebuggerUrl, "Runtime.evaluate", {
      expression: `({
        cards: document.querySelectorAll(${JSON.stringify("ytd-video-renderer, ytd-rich-item-renderer")}).length,
        filterStates: document.querySelectorAll(${JSON.stringify("[data-sift-filter-state]")}).length,
        visibility: document.visibilityState,
      })`,
      returnByValue: true,
    });
    latest = result.result.value ?? latest;
    if (latest.filterStates > 0) {
      return latest;
    }
    await delay(500);
  }
  return latest;
}

async function verifyCase(
  version: DevBrowserEndpoint,
  page: PageCase,
): Promise<void> {
  const target = await pageTarget(version, page.url);
  await delay(2_000);
  const tabId = await tabIdForTarget(version, target);
  const context = await waitForContext(version, tabId);
  if (
    !context ||
    context.site !== page.site ||
    context.timelineAvailable !== page.available
  ) {
    throw new Error(`${page.label} の対象判定が期待値と違う。`);
  }

  const options = await evaluateExtension<{ enabled?: boolean }>(
    version,
    `chrome.sidePanel.getOptions({ tabId: ${tabId} })`,
  );
  if ((options.enabled === true) !== page.available) {
    throw new Error(`${page.label} のサイドパネル有効化が期待値と違う。`);
  }

  if (!page.available) {
    console.log(`PASS ページ対象外: ${page.label}`);
    return;
  }

  await settingsCombinations(version, page.site);
  await evaluateExtension<void>(
    version,
    `chrome.tabs.sendMessage(${tabId}, { type: ${JSON.stringify(SET_FILTERING)}, enabled: true })`,
  );
  await delay(1_000);
  const filtering = await readContext(version, tabId);
  if (!filtering?.filteringEnabled) {
    throw new Error(`${page.label} でフィルタを有効にできなかった。`);
  }
  const filterState = await visibleFilterState(target);
  if (filterState.filterStates === 0) {
    throw new Error(
      `${page.label} の実在投稿へフィルタ状態を適用できなかった。` +
        ` 投稿カード: ${filterState.cards}件、可視状態: ${filterState.visibility}`,
    );
  }
  console.log(`PASS 対象ページ・設定反映: ${page.label}`);
}

const version = await readDevBrowserEndpoint(PROFILE);
if (!version) {
  throw new Error(
    "開発用 Chrome が起動していない。先に npm run dev:browser を実行すること。",
  );
}

await wakeExtension(version);
if (process.env.SIFT_E2E_MODE === "ci") {
  await waitForPanelDefaultSetup(version);
}
await verifySessionStorage(version);
const savedSettings = await currentSettings(version);
try {
  for (const page of pageCases) {
    await verifyCase(version, page);
  }
} finally {
  await setSettings(version, savedSettings);
}

console.log(
  "[sift] 実在ページ E2E: 4サイト・対象/対象外ページ・全設定組合せを確認した。",
);
