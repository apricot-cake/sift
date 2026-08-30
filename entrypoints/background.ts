import { browser } from "wxt/browser";
import { TIMELINE_CONTROL } from "../utils/timeline-controls.ts";

export default defineBackground(() => {
  const sidePanel = (browser as { sidePanel?: typeof browser.sidePanel })
    .sidePanel;
  void sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
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
