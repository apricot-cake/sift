import { browser } from "wxt/browser";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import { localizeDocument, t } from "../../utils/i18n.ts";
import {
  isTimelineControlState,
  TIMELINE_CONTROL,
  type TimelineControlMessage,
  type TimelineControlState,
} from "../../utils/timeline-controls.ts";

// このページで動いているものは全部が拡張機能自身のものなので、何も除かない。
// 購読は popup と同じだけ生きる。
startUncaughtReporting({
  target: window,
  source: "popup",
  filterToOwnCode: false,
});

// モジュールの最上位に置かず関数で包んであるのは、見つからなかったマークアップの
// 要素があったときに、途中で例外を投げるのではなく早く返せるように。要素そのものは
// 実行時に必ずある（index.html がどれも宣言している）ので、この早期の return が
// 実際に走ることはない。
function main(): void {
  // 何かを見せる前に。index.html はメッセージが入る場所に英語の文を持っていて、
  // そこへ読み手自身の言語を入れるのがこれ。
  localizeDocument(document);
  document.documentElement.lang = browser.i18n.getUILanguage();

  const status = document.querySelector<HTMLElement>('[data-role="status"]');
  const toggleFiltering = document.querySelector<HTMLButtonElement>(
    '[data-role="toggle-filtering"]',
  );
  const toggleShowAll = document.querySelector<HTMLButtonElement>(
    '[data-role="toggle-show-all"]',
  );
  const openOptions = document.querySelector<HTMLButtonElement>(
    '[data-role="open-options"]',
  );
  if (!status || !toggleFiltering || !toggleShowAll || !openOptions) {
    return;
  }

  const renderState = (state: TimelineControlState | null) => {
    const available = state?.timelineAvailable === true;
    const filteringEnabled = state?.filteringEnabled === true;
    status.textContent = available
      ? filteringEnabled
        ? t("popupFilterOn")
        : t("popupFilterOff")
      : t("popupStatusUnavailable");
    toggleFiltering.disabled = !available;
    toggleFiltering.textContent = filteringEnabled
      ? t("popupDisableFiltering")
      : t("popupEnableFiltering");
    toggleShowAll.disabled = !available || !filteringEnabled;
    toggleShowAll.textContent = state?.showAllTemporarily
      ? t("popupShowFiltered")
      : t("popupShowAll");
  };

  const sendToTimeline = async (type: TimelineControlMessage) => {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) {
      return null;
    }
    const response = await browser.tabs.sendMessage(tab.id, { type });
    return isTimelineControlState(response) ? response : null;
  };

  const updateTimeline = (type: TimelineControlMessage) => {
    void sendToTimeline(type)
      .then(renderState)
      .catch(() => renderState(null));
  };

  toggleFiltering.addEventListener("click", () => {
    updateTimeline(TIMELINE_CONTROL.toggleFiltering);
  });
  toggleShowAll.addEventListener("click", () => {
    updateTimeline(TIMELINE_CONTROL.toggleShowAll);
  });
  openOptions.addEventListener("click", () => {
    // ページが開けば Chrome が自分で popup を閉じる。そのページがタブなのか
    // 埋め込みの枠なのかを決めるのは options_ui で、
    // entrypoints/options/index.html はタブを求めている。
    void browser.runtime.openOptionsPage();
  });

  updateTimeline(TIMELINE_CONTROL.getState);
}

main();
