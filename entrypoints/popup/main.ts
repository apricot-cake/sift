import { browser } from "wxt/browser";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import { localizeDocument, t } from "../../utils/i18n.ts";
import {
  isSiteEnabled,
  normalizeSettings,
  type Settings,
  withSiteEnabled,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { isSiteControlAvailable } from "../../utils/site-controls.ts";

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
  const openOptions = document.querySelector<HTMLButtonElement>(
    '[data-role="open-options"]',
  );
  if (!status || !toggleFiltering || !openOptions) {
    return;
  }

  let activeHost: string | null = null;
  let currentSettings: Settings | null = null;

  const renderState = (settings: Settings | null, hostname: string | null) => {
    const available =
      hostname !== null &&
      settings !== null &&
      isSiteControlAvailable(hostname, settings);
    const filteringEnabled =
      available && settings !== null && hostname !== null
        ? isSiteEnabled(settings, hostname)
        : false;
    status.textContent = available
      ? filteringEnabled
        ? t("popupFilterOn")
        : t("popupFilterOff")
      : t("popupStatusUnavailable");
    toggleFiltering.disabled = !available;
    toggleFiltering.textContent = filteringEnabled
      ? t("popupDisableFiltering")
      : t("popupEnableFiltering");
  };

  const refresh = async () => {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const settings = normalizeSettings(await settingsItem.getValue());
    let hostname: string | null = null;
    try {
      hostname = tab?.url ? new URL(tab.url).hostname : null;
    } catch {
      hostname = null;
    }

    activeHost = hostname;
    currentSettings = settings;
    renderState(settings, hostname);
  };

  const toggle = async () => {
    if (activeHost === null || currentSettings === null) {
      return;
    }
    const updated = withSiteEnabled(
      currentSettings,
      activeHost,
      !isSiteEnabled(currentSettings, activeHost),
    );
    await settingsItem.setValue(updated);
    currentSettings = updated;
    renderState(updated, activeHost);
  };

  toggleFiltering.addEventListener("click", () => {
    void toggle().catch(() => refresh().catch(() => renderState(null, null)));
  });
  openOptions.addEventListener("click", () => {
    // ページが開けば Chrome が自分で popup を閉じる。そのページがタブなのか
    // 埋め込みの枠なのかを決めるのは options_ui で、
    // entrypoints/options/index.html はタブを求めている。
    void browser.runtime.openOptionsPage();
  });

  void refresh().catch(() => renderState(null, null));
}

main();
