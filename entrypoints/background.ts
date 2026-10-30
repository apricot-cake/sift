import { browser } from "wxt/browser";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
  isFilterContextResponse,
} from "../utils/filter-context.ts";
import {
  CHECK_LOCAL_BUILD,
  checkLocalBuild,
} from "../utils/local-build-reload.ts";
import { PANEL_CANCEL_LOAD } from "../utils/panel-load-more.ts";
import {
  hasLeftPanelPage,
  isXMediaNavigation,
  type PanelPage,
  panelPageContext,
  panelPageKey,
  panelPageUrl,
} from "../utils/panel-navigation.ts";
import {
  isSidePanelTabId,
  SIDE_PANEL_CONTROL,
  sidePanelOrigin,
  sidePanelPath,
  sidePanelTabIdFromUrl,
} from "../utils/sidepanel-controls.ts";
import { isSupportedSiteUrl } from "../utils/site-matches.ts";

const FILTER_CONTEXT_RETRY_COUNT = 8;
const FILTER_CONTEXT_RETRY_DELAY_MS = 25;

function waitForContentRuntime(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, FILTER_CONTEXT_RETRY_DELAY_MS);
  });
}

async function readFilterContext(
  tabId: number,
  reset = false,
): Promise<FilterContextResponse | null> {
  // 動的に注入する sift.js は executeScript が完了した直後でも、メッセージの
  // 受信準備を終えていないことがある。最初のクリックを捨てないよう、短時間だけ
  // 受信側の起動を待つ。
  for (let attempt = 0; attempt < FILTER_CONTEXT_RETRY_COUNT; attempt += 1) {
    const context = await browser.tabs
      .sendMessage(tabId, {
        type: FILTER_CONTEXT_REQUEST,
        ...(reset ? { reset: true } : {}),
      })
      .then((response) => (isFilterContextResponse(response) ? response : null))
      .catch(() => null);
    if (context !== null) {
      return context;
    }
    if (attempt + 1 < FILTER_CONTEXT_RETRY_COUNT) {
      await waitForContentRuntime();
    }
  }
  return null;
}

export default defineBackground(() => {
  if (__SIFT_LOCAL_BUILD__) {
    Object.defineProperty(globalThis, "__SIFT_RUNNING_BUILD_ID__", {
      value: __SIFT_BUILD_ID__,
      configurable: true,
    });
  }

  const sidePanel = (browser as { sidePanel?: typeof browser.sidePanel })
    .sidePanel;
  const panelActions = new Map<
    number,
    { generation: symbol; windowId: number } | null
  >();
  const panelCleanups = new Map<number, Promise<void>>();

  function prepareTab(tabId: number): Promise<void> | undefined {
    return sidePanel?.setOptions({
      tabId,
      path: sidePanelPath(tabId),
      enabled: true,
    });
  }

  // 自動開閉では activeTab が付与されないため、action から明示的に開く。
  // タブ切替時の非表示・復元は Chrome が管理し、接続は onOpened にまとめる。
  void sidePanel?.setPanelBehavior({ openPanelOnActionClick: false });
  void (async () => {
    await sidePanel?.setOptions({ enabled: false });
    const stored = await browser.storage.session.get(null);
    const legacyKeys = Object.keys(stored).filter(
      (key) =>
        key === "sift:sidepanel-tab-id" ||
        key.startsWith("sift:sidepanel-origin:"),
    );
    if (legacyKeys.length) await browser.storage.session.remove(legacyKeys);
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs.map((tab) =>
        tab.id === undefined ? undefined : prepareTab(tab.id),
      ),
    );
  })().catch(console.error);
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) void prepareTab(tab.id)?.catch(console.error);
  });
  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    const tabId = tab.id;
    const previousAction = panelActions.get(tabId);
    // パネルの幅変更より前に、一覧で読んでいた実投稿の位置を記録する。
    const viewport = isSupportedSiteUrl(tab.url)
      ? browser.scripting.executeScript({
          target: { tabId },
          files: ["/panel-viewport.js"],
        })
      : undefined;
    // open はユーザー操作が有効な同期区間で呼ぶ。
    const configured = prepareTab(tabId);
    const opened = sidePanel?.open({ tabId });
    void Promise.all([viewport, configured, opened])
      .then(async () => {
        // 表示中のパネルには onOpened が来ない。許可を取り直したクリックでは
        // 既存の所有タブへ再接続する。初回起動・閉鎖・再開の通知とは競合させない。
        if (
          previousAction === null ||
          panelActions.get(tabId) !== previousAction
        )
          return;
        const key = panelPageKey(tabId);
        const stored = await browser.storage.session.get(key);
        if (!stored[key] || panelActions.get(tabId) !== previousAction) return;
        const generation = Symbol();
        panelActions.set(tabId, { generation, windowId: tab.windowId });
        await connectOpenedPanel(tabId, tab.windowId, generation, true);
      })
      .catch(console.error);
  });

  async function connectOpenedPanel(
    tabId: number,
    windowId: number,
    generation: symbol,
    restore: boolean,
  ): Promise<void> {
    const isCurrent = () => panelActions.get(tabId)?.generation === generation;
    if (__SIFT_LOCAL_DEPLOY__ && !(await checkLocalBuild(__SIFT_BUILD_ID__)))
      return;
    // 先に閉じたパネルの削除が、新しい所有記録を消さないようにする。
    await panelCleanups.get(tabId);
    if (!isCurrent()) return;
    const [tab, stored] = await Promise.all([
      browser.tabs.get(tabId),
      browser.storage.session.get(panelPageKey(tabId)),
    ]);
    if (!isCurrent()) return;

    // 復帰時には元の一覧と条件を保つ。閉じた後の再起動だけを初期化する。
    const previous = restore
      ? (stored[panelPageKey(tabId)] as PanelPage | undefined)
      : undefined;
    const opening: PanelPage = {
      ...previous,
      id: crypto.randomUUID(),
      url: previous?.url ?? panelPageUrl(tab.url),
      windowId,
    };
    await browser.storage.session.set({
      [panelPageKey(tabId)]: opening,
    });
    if (!isCurrent()) return;
    // 新しいパネル自身が初期値を設定する。既存ビューを閉じて再開した場合だけ、
    // 注入や応答待ちより先に初期化を通知する。復帰や遅い応答で選択値を戻さない。
    await browser.runtime
      .sendMessage({
        type: SIDE_PANEL_CONTROL.setPanelTab,
        tabId,
        resetMinimum: !restore,
      })
      .catch(() => {});
    if (!isCurrent()) return;
    if (isSupportedSiteUrl(tab.url)) {
      const target = { tabId };
      await browser.scripting.executeScript({ target, files: ["/sift.js"] });
      if (!isCurrent()) return;
      // カードが未描画でも閉じない。対応状況はパネルが継続して取得する。
      const context = await readFilterContext(tabId, previous === undefined);
      const current = await browser.storage.session.get(panelPageKey(tabId));
      const latestTab = await browser.tabs.get(tabId).catch(() => null);
      if (
        isCurrent() &&
        context &&
        (current[panelPageKey(tabId)] as PanelPage | undefined)?.id ===
          opening.id &&
        panelPageUrl(latestTab?.url) === opening.url
      ) {
        await browser.storage.session.set({
          [panelPageKey(tabId)]: {
            ...opening,
            context: panelPageContext(context),
          },
        });
      }
    }
    if (!isCurrent()) return;
    void browser.runtime
      .sendMessage({
        type: SIDE_PANEL_CONTROL.setPanelTab,
        tabId,
      })
      .catch(() => {});
  }

  async function checkOpenPage(tabId: number): Promise<boolean | null> {
    const key = panelPageKey(tabId);
    const record = await browser.storage.session.get(key);
    const opening = record[key] as PanelPage | undefined;
    if (!opening) return null;
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    const url = panelPageUrl(tab.url);
    const context = isSupportedSiteUrl(tab.url)
      ? await readFilterContext(tabId)
      : null;
    let close =
      url === null ||
      sidePanelOrigin(url ?? undefined) !==
        sidePanelOrigin(opening.url ?? undefined);
    if (!close && context && opening.context)
      close = hasLeftPanelPage(opening, context);
    if (!close && !opening.context && url !== opening.url) close = true;
    if (!close && !context && url !== opening.url) close = true;
    // SPAではURL更新がモーダル描画より先に届く。背景一覧が確認できるまで短く猶予する。
    if (
      close &&
      isXMediaNavigation(url) &&
      sidePanelOrigin(url ?? undefined) ===
        sidePanelOrigin(opening.url ?? undefined)
    ) {
      const pending =
        opening.pendingMedia?.url === url
          ? opening.pendingMedia
          : { url: url as string, since: Date.now() };
      if (Date.now() - pending.since < 1500) {
        const latest = await browser.storage.session.get(key);
        if ((latest[key] as PanelPage | undefined)?.id === opening.id)
          await browser.storage.session.set({
            [key]: { ...opening, pendingMedia: pending },
          });
        return false;
      }
    }
    const latest = await browser.storage.session.get(key);
    const latestTab = await browser.tabs.get(tabId).catch(() => null);
    if (
      (latest[key] as PanelPage | undefined)?.id !== opening.id ||
      panelPageUrl(latestTab?.url) !== url
    )
      return false;
    if (close) {
      // enabled は起動可否。閉鎖は close に任せ、次のクリックで再開できる状態にする。
      await sidePanel?.close({ tabId });
      return true;
    }
    const { pendingMedia: _pending, ...confirmed } = opening;
    const fillContext =
      context &&
      (!opening.context ||
        (!opening.context.timelineKey && context.timelineKey));
    if (opening.pendingMedia || fillContext)
      await browser.storage.session.set({
        [key]: {
          ...confirmed,
          ...(fillContext ? { context: panelPageContext(context) } : {}),
        },
      });
    return false;
  }

  async function refreshOpenPanelForNavigation(
    tabId: number,
    tab: Browser.tabs.Tab,
  ): Promise<void> {
    const key = panelPageKey(tabId);
    const stored = await browser.storage.session.get(key);
    const opening = stored[key] as PanelPage | undefined;
    if (!opening) return;
    const isCurrent = async () => {
      const latest = await browser.storage.session.get(key);
      return (latest[key] as PanelPage | undefined)?.id === opening.id;
    };

    // onUpdated の tab は、tabs 権限がない activeTab 拡張では URL を含まない
    // ことがある。ユーザーが action を実行した同じタブだけを再取得する。
    const url =
      tab.url ?? (await browser.tabs.get(tabId).catch(() => null))?.url;
    if (!(await isCurrent())) return;
    if (!isSupportedSiteUrl(url)) {
      void browser.runtime
        .sendMessage({ type: SIDE_PANEL_CONTROL.setPanelTab, tabId })
        .catch(() => {});
      return;
    }

    // 同じ document の SPA 遷移なら既存の runtime が応答する。ページ遷移で
    // content script が失われたときだけ再注入するので、監視処理を重ねない。
    if ((await readFilterContext(tabId)) === null) {
      if (!(await isCurrent())) return;
      const target = { tabId };
      await browser.scripting.executeScript({ target, files: ["/sift.js"] });
    }

    if (!(await isCurrent())) return;
    void browser.runtime
      .sendMessage({ type: SIDE_PANEL_CONTROL.setPanelTab, tabId })
      .catch(() => {});
  }

  async function handleNavigation(tabId: number): Promise<void> {
    if ((await checkOpenPage(tabId)) !== false) return;
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (tab) await refreshOpenPanelForNavigation(tabId, tab);
  }

  // パネルの復元やタブ切替は action を伴わない。既に許可された現在のタブなら
  // 接続を復旧する。新しいサイト権限は要求せず、拒否された場合はパネルで案内する。
  browser.runtime.onMessage.addListener((message, sender) => {
    const owner = sender.url ? sidePanelTabIdFromUrl(sender.url) : null;
    const panelSender =
      owner !== null &&
      sender.url ===
        `${browser.runtime.getURL("/sidepanel.html")}?tabId=${owner}` &&
      sender.tab === undefined;
    if (message?.type === CHECK_LOCAL_BUILD && panelSender)
      return __SIFT_LOCAL_DEPLOY__
        ? checkLocalBuild(__SIFT_BUILD_ID__)
        : Promise.resolve(true);
    // ファイルの再取得ではなく、現在実行中のバックグラウンドがビルドIDを返す。
    // 検証候補とローカル配備の診断専用。通常ページ・content scriptからは受け付けない。
    if (
      __SIFT_LOCAL_BUILD__ &&
      message?.type === "sift:get-local-build" &&
      panelSender
    )
      return Promise.resolve({ buildId: __SIFT_BUILD_ID__ });
    if (
      panelSender &&
      message?.type === SIDE_PANEL_CONTROL.checkPage &&
      message.tabId === owner
    )
      return checkOpenPage(owner).catch(() => false);
    if (
      !panelSender ||
      message?.type !== SIDE_PANEL_CONTROL.connectTab ||
      !isSidePanelTabId(message.tabId) ||
      message.tabId !== owner
    )
      return;
    return (async () => {
      const tab = await browser.tabs.get(message.tabId);
      if (!tab.active) return false;
      await refreshOpenPanelForNavigation(message.tabId, tab);
      return true;
    })().catch(() => false);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url !== undefined || changeInfo.status === "complete") {
      void handleNavigation(tabId).catch(() => {});
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    panelActions.delete(tabId);
    void browser.storage.session.remove(panelPageKey(tabId));
  });

  sidePanel?.onOpened.addListener((panel) => {
    // Chrome の通知パスは先頭の / やクエリの有無が異なる。所有者は通知のtabIdで判定する。
    if (
      panel.tabId !== undefined &&
      new URL(panel.path, browser.runtime.getURL("/sidepanel.html"))
        .pathname === "/sidepanel.html"
    ) {
      const tabId = panel.tabId;
      const generation = Symbol();
      const restore = panelActions.get(tabId) !== null;
      panelActions.set(tabId, { generation, windowId: panel.windowId });
      void connectOpenedPanel(tabId, panel.windowId, generation, restore).catch(
        console.error,
      );
    }
  });
  sidePanel?.onClosed?.addListener((panel) => {
    const tabId = panel.tabId;
    if (tabId === undefined) return;
    const current = panelActions.get(tabId);
    if (current && current.windowId !== panel.windowId) return;
    panelActions.set(tabId, null);
    void browser.tabs
      .sendMessage(tabId, { type: PANEL_CANCEL_LOAD })
      .catch(() => {});
    const cleanup = (async () => {
      const key = panelPageKey(tabId);
      const stored = await browser.storage.session.get(key);
      const opening = stored[key] as PanelPage | undefined;
      if (panelActions.get(tabId) !== null) return;
      if (
        opening?.windowId !== undefined &&
        opening.windowId !== panel.windowId
      )
        return;
      await browser.storage.session.remove(key);
    })()
      .catch(() => {})
      .finally(() => {
        if (panelCleanups.get(tabId) === cleanup) panelCleanups.delete(tabId);
      });
    panelCleanups.set(tabId, cleanup);
  });
});
