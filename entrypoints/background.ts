import { browser } from "wxt/browser";
import { contentStyle } from "../utils/content-style.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
  isFilterContextResponse,
} from "../utils/filter-context.ts";
import {
  CHECK_LOCAL_BUILD,
  checkLocalBuild,
} from "../utils/local-build-reload.ts";
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
  SIDE_PANEL_TAB_STORAGE_KEY,
  sidePanelOrigin,
  sidePanelOriginKey,
  sidePanelPath,
  sidePanelTabIdFromUrl,
} from "../utils/sidepanel-controls.ts";
import { isSupportedSiteUrl } from "../utils/site-matches.ts";
import { TIMELINE_CONTROL } from "../utils/timeline-controls.ts";

const FILTER_CONTEXT_RETRY_COUNT = 8;
const FILTER_CONTEXT_RETRY_DELAY_MS = 25;

function waitForContentRuntime(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, FILTER_CONTEXT_RETRY_DELAY_MS);
  });
}

async function readFilterContext(
  tabId: number,
): Promise<FilterContextResponse | null> {
  // 動的に注入する sift.js は executeScript が完了した直後でも、メッセージの
  // 受信準備を終えていないことがある。最初のクリックを捨てないよう、短時間だけ
  // 受信側の起動を待つ。
  for (let attempt = 0; attempt < FILTER_CONTEXT_RETRY_COUNT; attempt += 1) {
    const context = await browser.tabs
      .sendMessage(tabId, { type: FILTER_CONTEXT_REQUEST })
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
  if (__SIFT_LOCAL_DEPLOY__) {
    Object.defineProperty(globalThis, "__SIFT_RUNNING_BUILD_ID__", {
      value: __SIFT_BUILD_ID__,
      configurable: true,
    });
  }

  const sidePanel = (browser as { sidePanel?: typeof browser.sidePanel })
    .sidePanel;
  const panelActions = new Map<number, symbol>();
  const panelNotifications = new Map<number, symbol>();

  // 旧版の自動開閉設定は Chrome のプロファイルに残る。有効なままだと
  // ツールバーのクリックが onClicked に届かず、activeTab の接続処理も
  // 実行されない。更新・再読み込みのいずれでも現在の起動方式に揃える。
  void sidePanel?.setPanelBehavior({ openPanelOnActionClick: false });

  // default_path は WXT が manifest に生成する。共通パネルの設定が残ると、
  // 所有タブへの復帰後に未開封の別タブでも表示されるため、worker 起動時に無効化する。
  // tabId を省略した設定は既定値だけを変え、開封済みのタブ固有パネルは維持する。
  void sidePanel?.setOptions({ enabled: false });

  async function openPanelForActiveTab(tab: Browser.tabs.Tab): Promise<void> {
    if (tab.id === undefined) {
      return;
    }
    const generation = Symbol();
    panelActions.set(tab.id, generation);
    const isCurrent = () => panelActions.get(tab.id as number) === generation;

    // 非同期のページ判定を待つと action のユーザー操作が失われるため、
    // 全サイトで最初の await より前に開く。
    const opening: PanelPage = {
      id: crypto.randomUUID(),
      url: panelPageUrl(tab.url),
    };
    const savedTab = browser.storage.session.set({
      [SIDE_PANEL_TAB_STORAGE_KEY]: tab.id,
      [sidePanelOriginKey(tab.id)]: sidePanelOrigin(tab.url),
      [panelPageKey(tab.id)]: opening,
    });
    const configured = sidePanel?.setOptions({
      tabId: tab.id,
      path: sidePanelPath(tab.id),
      enabled: true,
    });
    const panelOpening = sidePanel?.open({ tabId: tab.id });
    // open はユーザー操作が有効な同期区間で呼ぶ。更新確認を待ってから
    // 呼ぶと Chrome に拒まれるため、先に開き、新版ならリロードで閉じる。
    const currentBuild = __SIFT_LOCAL_DEPLOY__
      ? checkLocalBuild(__SIFT_BUILD_ID__)
      : Promise.resolve(true);
    await Promise.all([savedTab, configured, panelOpening]);
    if (!(await currentBuild) || !isCurrent()) return;
    if (isSupportedSiteUrl(tab.url)) {
      const target = { tabId: tab.id };
      await browser.scripting.insertCSS({ target, css: contentStyle });
      if (!isCurrent()) return;
      await browser.scripting.executeScript({ target, files: ["/sift.js"] });
      if (!isCurrent()) return;
      // カードが未描画でも閉じない。対応状況はパネルが継続して取得する。
      const context = await readFilterContext(tab.id);
      const current = await browser.storage.session.get(panelPageKey(tab.id));
      const latestTab = await browser.tabs.get(tab.id).catch(() => null);
      if (
        isCurrent() &&
        context &&
        (current[panelPageKey(tab.id)] as PanelPage | undefined)?.id ===
          opening.id &&
        panelPageUrl(latestTab?.url) === opening.url
      ) {
        await browser.storage.session.set({
          [panelPageKey(tab.id)]: {
            ...opening,
            context: panelPageContext(context),
          },
        });
      }
    }
    // 既存のパネルを開き直す場合は onOpened が発火しないことがある。
    // 注入後にも所有タブを通知し、開き直したパネルの接続を更新する。
    if (!isCurrent()) return;
    void browser.runtime
      .sendMessage({
        type: SIDE_PANEL_CONTROL.setPanelTab,
        tabId: tab.id,
        resetMinimum: true,
      })
      .catch(() => {});
  }

  async function checkOpenPage(tabId: number): Promise<boolean> {
    const key = panelPageKey(tabId);
    const record = await browser.storage.session.get(key);
    const opening = record[key] as PanelPage | undefined;
    if (!opening) return false;
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
      await sidePanel?.setOptions({ tabId, enabled: false });
      const after = await browser.storage.session.get(key);
      if ((after[key] as PanelPage | undefined)?.id === opening.id)
        await browser.storage.session.remove(key);
      await browser.tabs
        .sendMessage(tabId, {
          type: TIMELINE_CONTROL.setFiltering,
          enabled: false,
        })
        .catch(() => {});
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
    let panelTabId: unknown;
    try {
      const stored = await browser.storage.session.get(
        SIDE_PANEL_TAB_STORAGE_KEY,
      );
      panelTabId = stored[SIDE_PANEL_TAB_STORAGE_KEY];
    } catch {
      return;
    }
    if (panelTabId !== tabId) {
      return;
    }

    // onUpdated の tab は、tabs 権限がない activeTab 拡張では URL を含まない
    // ことがある。ユーザーが action を実行した同じタブだけを再取得する。
    const url =
      tab.url ?? (await browser.tabs.get(tabId).catch(() => null))?.url;
    if (!isSupportedSiteUrl(url)) {
      void browser.runtime
        .sendMessage({ type: SIDE_PANEL_CONTROL.setPanelTab, tabId })
        .catch(() => {});
      return;
    }

    // 同じ document の SPA 遷移なら既存の runtime が応答する。ページ遷移で
    // content script が失われたときだけ再注入するので、監視処理を重ねない。
    if ((await readFilterContext(tabId)) === null) {
      const target = { tabId };
      await browser.scripting.insertCSS({ target, css: contentStyle });
      await browser.scripting.executeScript({ target, files: ["/sift.js"] });
    }

    void browser.runtime
      .sendMessage({ type: SIDE_PANEL_CONTROL.setPanelTab, tabId })
      .catch(() => {});
  }

  async function handleNavigation(tabId: number): Promise<void> {
    // 非アクティブなタブの遷移も検査する。タブ単位の記録は worker の休止を
    // またいで保持し、別タブのパネルには影響させない。
    const key = sidePanelOriginKey(tabId);
    const pageKey = panelPageKey(tabId);
    const stored = await browser.storage.session.get([key, pageKey]);
    const opening = stored[pageKey] as PanelPage | undefined;
    if (!Object.hasOwn(stored, key)) return;
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    const origin = sidePanelOrigin(tab.url);
    // 別 origin への遷移で activeTab が失効すると URL 自体が取得できない。
    // 読み込み完了時にも URL がない場合は、接続を維持できないので閉じる。
    if (origin !== stored[key] || origin === null) {
      // tabs.getを待つ間にactionで再接続した場合、古い遷移で新しいパネルを閉じない。
      const latest = await browser.storage.session.get([key, pageKey]);
      if (
        latest[key] !== stored[key] ||
        (latest[pageKey] as PanelPage | undefined)?.id !== opening?.id
      )
        return;
      await sidePanel?.setOptions({ tabId, enabled: false });
      return;
    }
    if (await checkOpenPage(tabId)) return;
    await refreshOpenPanelForNavigation(tabId, tab);
  }

  browser.action.onClicked.addListener((tab) => {
    void openPanelForActiveTab(tab).catch((error: unknown) => {
      console.error("sift のサイドパネルを開けなかった。", error);
    });
  });

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
    // ローカル配備の診断専用。通常ページ・content scriptからは受け付けない。
    if (
      __SIFT_LOCAL_DEPLOY__ &&
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
      await browser.storage.session.set({
        [SIDE_PANEL_TAB_STORAGE_KEY]: tab.id,
      });
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
    panelNotifications.delete(tabId);
    void browser.storage.session.remove(sidePanelOriginKey(tabId));
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
      panelNotifications.set(tabId, generation);
      const notifyPanel = () => {
        if (panelNotifications.get(tabId) !== generation) return;
        void browser.storage.session.set({
          [SIDE_PANEL_TAB_STORAGE_KEY]: tabId,
        });
        void browser.runtime
          .sendMessage({
            type: SIDE_PANEL_CONTROL.setPanelTab,
            tabId,
          })
          .catch(() => {});
      };
      if (__SIFT_LOCAL_DEPLOY__)
        void checkLocalBuild(__SIFT_BUILD_ID__).then((current) => {
          if (current) notifyPanel();
        });
      else notifyPanel();
    }
  });
  sidePanel?.onClosed?.addListener((panel) => {
    if (panel.tabId === undefined) {
      panelActions.clear();
      panelNotifications.clear();
    } else {
      panelActions.delete(panel.tabId);
      panelNotifications.delete(panel.tabId);
    }
    const remainsClosed = (tabId: number) =>
      !panelActions.has(tabId) && !panelNotifications.has(tabId);
    void browser.storage.session
      .get(SIDE_PANEL_TAB_STORAGE_KEY)
      .then((stored) => {
        if (
          (panel.tabId === undefined ||
            stored[SIDE_PANEL_TAB_STORAGE_KEY] === panel.tabId) &&
          (typeof stored[SIDE_PANEL_TAB_STORAGE_KEY] !== "number" ||
            remainsClosed(stored[SIDE_PANEL_TAB_STORAGE_KEY] as number))
        ) {
          void browser.storage.session.remove(SIDE_PANEL_TAB_STORAGE_KEY);
        }
      });
    void browser.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (
          tab.id !== undefined &&
          (panel.tabId === undefined || panel.tabId === tab.id) &&
          remainsClosed(tab.id)
        ) {
          void browser.tabs
            .sendMessage(tab.id, {
              type: TIMELINE_CONTROL.setFiltering,
              enabled: false,
            })
            .catch(() => {});
        }
      }
    });
  });
});
