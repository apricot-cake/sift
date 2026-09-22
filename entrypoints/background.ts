import { browser } from "wxt/browser";
import { contentStyle } from "../utils/content-style.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
  isFilterContextResponse,
} from "../utils/filter-context.ts";
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
  const sidePanel = (browser as { sidePanel?: typeof browser.sidePanel })
    .sidePanel;

  // default_path は WXT が manifest に生成する。パネルはユーザーが action を
  // 実行し、現在のタブが対応タイムラインだと確認できた場合だけ開く。
  void sidePanel?.setOptions({ enabled: false });

  async function openPanelForActiveTab(tab: Browser.tabs.Tab): Promise<void> {
    if (tab.id === undefined || !isSupportedSiteUrl(tab.url)) {
      return;
    }

    const target = { tabId: tab.id };
    await browser.scripting.insertCSS({ target, css: contentStyle });
    await browser.scripting.executeScript({ target, files: ["/sift.js"] });
    const context = await readFilterContext(tab.id);
    if (context === null || !context.timelineAvailable) {
      return;
    }

    await browser.storage.session.set({
      [SIDE_PANEL_TAB_STORAGE_KEY]: tab.id,
    });
    await sidePanel?.setOptions({
      tabId: tab.id,
      path: "sidepanel.html",
      enabled: true,
    });
    await sidePanel?.open({ tabId: tab.id });
  }

  browser.action.onClicked.addListener((tab) => {
    void openPanelForActiveTab(tab).catch(() => {});
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
