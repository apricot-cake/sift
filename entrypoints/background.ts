import { browser } from "wxt/browser";
import {
  isSidePanelConfigureRequest,
  SIDE_PANEL_CONTROL,
} from "../utils/sidepanel-controls.ts";
import { isSupportedSiteUrl } from "../utils/site-matches.ts";
import { TIMELINE_CONTROL } from "../utils/timeline-controls.ts";

export default defineBackground(() => {
  const sidePanel = (browser as { sidePanel?: typeof browser.sidePanel })
    .sidePanel;

  const configureSidePanel = (
    tab: Browser.tabs.Tab,
    enabled: boolean,
  ): void => {
    if (tab.id === undefined) {
      return;
    }
    void sidePanel
      ?.setOptions({
        tabId: tab.id,
        path: "sidepanel.html",
        enabled,
      })
      .catch(() => {});
  };

  // default_path は WXT が manifest に生成する。グローバルな既定値を無効にして、
  // 対応サイトごとに作るタブ固有パネルだけを開けるようにする。
  const sidePanelReady = (async () => {
    await sidePanel?.setOptions({ enabled: false });
    await sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
    const tabs = await browser.tabs.query({});
    tabs.forEach((tab) => {
      configureSidePanel(tab, false);
    });
  })();
  // setPanelBehavior だけに任せると、CDP 経由の action 実行でパネルが開かない
  // Chrome があるため、クリック時にもタブ固有の有効状態を確認して明示的に開く。
  browser.action.onClicked.addListener((tab) => {
    const tabId = tab.id;
    if (tabId === undefined) {
      return;
    }
    void sidePanelReady.then(async () => {
      const options = await sidePanel?.getOptions({ tabId });
      if (options?.enabled) {
        await sidePanel?.open({ tabId });
      }
    });
  });
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined) {
      void sidePanelReady.then(() => configureSidePanel(tab, false));
    }
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    const tab = sender.tab;
    const url = sender.url;
    if (
      isSidePanelConfigureRequest(message) &&
      tab !== undefined &&
      url !== undefined
    ) {
      void sidePanelReady.then(() =>
        configureSidePanel(tab, message.available && isSupportedSiteUrl(url)),
      );
    }
  });
  sidePanel?.onOpened.addListener((panel) => {
    if (panel.path === "sidepanel.html" && panel.tabId !== undefined) {
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
