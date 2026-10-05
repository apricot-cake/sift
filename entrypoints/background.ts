import { browser } from "wxt/browser";
import { contentStyle } from "../utils/content-style.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
  isFilterContextResponse,
} from "../utils/filter-context.ts";
import { startLocalBuildReload } from "../utils/local-build-reload.ts";
import {
  isSidePanelTabId,
  SIDE_PANEL_CONTROL,
  SIDE_PANEL_TAB_STORAGE_KEY,
  sidePanelOrigin,
  sidePanelOriginKey,
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
    startLocalBuildReload(__SIFT_BUILD_ID__);
  }

  const sidePanel = (browser as { sidePanel?: typeof browser.sidePanel })
    .sidePanel;

  // 旧版の自動開閉設定は Chrome のプロファイルに残る。有効なままだと
  // ツールバーのクリックが onClicked に届かず、activeTab の接続処理も
  // 実行されない。更新・再読み込みのいずれでも現在の起動方式に揃える。
  void sidePanel?.setPanelBehavior({ openPanelOnActionClick: false });

  // default_path は WXT が manifest に生成する。パネルはユーザーが action を
  // 実行したタブで開き、対象外のサイト・ページはパネル内で案内する。worker の
  // 起動ごとに無効化すると、action 後に worker が再起動しただけで開いたパネルが
  // 無効になるため、初回インストールまたは更新時だけ既定値を設定する。
  browser.runtime.onInstalled.addListener(() => {
    void sidePanel?.setOptions({ enabled: false });
  });

  async function openPanelForActiveTab(tab: Browser.tabs.Tab): Promise<void> {
    if (tab.id === undefined) {
      return;
    }

    // 非同期のページ判定を待つと action のユーザー操作が失われるため、
    // 全サイトで最初の await より前に開く。
    const savedTab = browser.storage.session.set({
      [SIDE_PANEL_TAB_STORAGE_KEY]: tab.id,
      [sidePanelOriginKey(tab.id)]: sidePanelOrigin(tab.url),
    });
    const configured = sidePanel?.setOptions({
      tabId: tab.id,
      path: "sidepanel.html",
      enabled: true,
    });
    const panelOpening = sidePanel?.open({ tabId: tab.id });
    await Promise.all([savedTab, configured, panelOpening]);
    if (isSupportedSiteUrl(tab.url)) {
      const target = { tabId: tab.id };
      await browser.scripting.insertCSS({ target, css: contentStyle });
      await browser.scripting.executeScript({ target, files: ["/sift.js"] });
      // カードが未描画でも閉じない。対応状況はパネルが継続して取得する。
      await readFilterContext(tab.id);
    }
    // 既存のパネルを開き直す場合は onOpened が発火しないことがある。
    // 注入後にも接続先を通知し、前のタブに結び付いたままにしない。
    void browser.runtime
      .sendMessage({
        type: SIDE_PANEL_CONTROL.setPanelTab,
        tabId: tab.id,
      })
      .catch(() => {});
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
    const stored = await browser.storage.session.get(key);
    if (!Object.hasOwn(stored, key)) return;
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    const origin = sidePanelOrigin(tab.url);
    // 別 origin への遷移で activeTab が失効すると URL 自体が取得できない。
    // 読み込み完了時にも URL がない場合は、接続を維持できないので閉じる。
    if (origin !== stored[key] || origin === null) {
      await sidePanel?.setOptions({ tabId, enabled: false });
      return;
    }
    await refreshOpenPanelForNavigation(tabId, tab);
  }

  browser.action.onClicked.addListener((tab) => {
    void openPanelForActiveTab(tab).catch((error: unknown) => {
      console.error("Sift のサイドパネルを開けなかった。", error);
    });
  });

  // パネルの復元やタブ切替は action を伴わない。既に許可された現在のタブなら
  // 接続を復旧する。新しいサイト権限は要求せず、拒否された場合はパネルで案内する。
  browser.runtime.onMessage.addListener((message, sender) => {
    // ファイルの再取得ではなく、現在実行中のバックグラウンドがビルドIDを返す。
    // ローカル配備の診断専用。通常ページ・content scriptからは受け付けない。
    if (
      __SIFT_LOCAL_DEPLOY__ &&
      message?.type === "sift:get-local-build" &&
      sender.url === browser.runtime.getURL("/sidepanel.html") &&
      sender.tab === undefined
    )
      return Promise.resolve({ buildId: __SIFT_BUILD_ID__ });
    if (
      sender.url !== browser.runtime.getURL("/sidepanel.html") ||
      sender.tab !== undefined ||
      message?.type !== SIDE_PANEL_CONTROL.connectTab ||
      !isSidePanelTabId(message.tabId)
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
    void browser.storage.session.remove(sidePanelOriginKey(tabId));
  });

  sidePanel?.onOpened.addListener((panel) => {
    // Chrome の開閉通知では先頭に / が付く場合がある。
    if (
      (panel.path === "sidepanel.html" || panel.path === "/sidepanel.html") &&
      panel.tabId !== undefined
    ) {
      void browser.storage.session.set({
        [SIDE_PANEL_TAB_STORAGE_KEY]: panel.tabId,
      });
      void browser.runtime
        .sendMessage({
          type: SIDE_PANEL_CONTROL.setPanelTab,
          tabId: panel.tabId,
          resetMinimum: true,
        })
        .catch(() => {});
    }
  });
  sidePanel?.onClosed?.addListener((panel) => {
    void browser.storage.session
      .get(SIDE_PANEL_TAB_STORAGE_KEY)
      .then((stored) => {
        if (
          panel.tabId === undefined ||
          stored[SIDE_PANEL_TAB_STORAGE_KEY] === panel.tabId
        ) {
          void browser.storage.session.remove(SIDE_PANEL_TAB_STORAGE_KEY);
        }
      });
    void browser.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (
          tab.id !== undefined &&
          (panel.tabId === undefined || panel.tabId === tab.id)
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
