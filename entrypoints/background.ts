import { browser } from "wxt/browser";
import { contentStyle } from "../utils/content-style.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
  isFilterContextResponse,
} from "../utils/filter-context.ts";
import { startLocalBuildReload } from "../utils/local-build-reload.ts";
import {
  SIDE_PANEL_CONTROL,
  SIDE_PANEL_TAB_STORAGE_KEY,
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
    startLocalBuildReload(__SIFT_BUILD_ID__);
  }

  const sidePanel = (browser as { sidePanel?: typeof browser.sidePanel })
    .sidePanel;

  // default_path は WXT が manifest に生成する。パネルはユーザーが action を
  // 実行した対応サイトで開き、対象外のページなら閉じる。worker の
  // 起動ごとに無効化すると、action 後に worker が再起動しただけで開いたパネルが
  // 無効になるため、初回インストールまたは更新時だけ既定値を設定する。
  browser.runtime.onInstalled.addListener(() => {
    void sidePanel?.setOptions({ enabled: false });
  });

  async function openPanelForActiveTab(tab: Browser.tabs.Tab): Promise<void> {
    if (tab.id === undefined || !isSupportedSiteUrl(tab.url)) {
      return;
    }

    // 非同期のページ判定を待つと action のユーザー操作が失われるため、
    // 全サイトで最初の await より前に開く。対象外なら下の判定で閉じる。
    const savedTab = browser.storage.session.set({
      [SIDE_PANEL_TAB_STORAGE_KEY]: tab.id,
    });
    const configured = sidePanel?.setOptions({
      tabId: tab.id,
      path: "sidepanel.html",
      enabled: true,
    });
    const panelOpening = sidePanel?.open({ tabId: tab.id });
    await Promise.all([savedTab, configured, panelOpening]);
    const target = { tabId: tab.id };
    await browser.scripting.insertCSS({ target, css: contentStyle });
    await browser.scripting.executeScript({ target, files: ["/sift.js"] });
    const context = await readFilterContext(tab.id);
    if (context === null || !context.timelineAvailable) {
      await sidePanel?.setOptions({ tabId: tab.id, enabled: false });
    }
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

  browser.action.onClicked.addListener((tab) => {
    void openPanelForActiveTab(tab).catch((error: unknown) => {
      console.error("Sift のサイドパネルを開けなかった。", error);
    });
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined || changeInfo.status === "complete") {
      void refreshOpenPanelForNavigation(tabId, tab).catch(() => {});
    }
  });

  sidePanel?.onOpened.addListener((panel) => {
    if (panel.path === "sidepanel.html" && panel.tabId !== undefined) {
      void browser.storage.session.set({
        [SIDE_PANEL_TAB_STORAGE_KEY]: panel.tabId,
      });
      void browser.runtime
        .sendMessage({
          type: SIDE_PANEL_CONTROL.setPanelTab,
          tabId: panel.tabId,
        })
        .catch(() => {});
    }
  });
  sidePanel?.onClosed?.addListener(() => {
    void browser.storage.session.remove(SIDE_PANEL_TAB_STORAGE_KEY);
    void browser.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
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
