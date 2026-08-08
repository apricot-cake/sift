import { browser } from "wxt/browser";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import { localizeDocument, t } from "../../utils/i18n.ts";
import { normalizeSettings } from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";

// Everything running on this page is the extension's own, so nothing is
// filtered out. The subscription lives as long as the popup does.
startUncaughtReporting({
  target: window,
  source: "popup",
  filterToOwnCode: false,
});

// Wrapped in a function, rather than left at module top level, so a markup
// element that failed to resolve can early-return instead of throwing partway
// through. The elements themselves are always present at runtime (index.html
// declares every one of them), so the early return never actually fires.
function main(): void {
  // Before anything is shown: index.html carries English text where the
  // messages go, and this is what puts the reader's own language there.
  localizeDocument(document);
  document.documentElement.lang = browser.i18n.getUILanguage();

  const maybeToggle = document.querySelector<HTMLInputElement>(
    '[data-setting="enabled"]',
  );
  const maybeOpenOptions = document.querySelector<HTMLButtonElement>(
    '[data-role="open-options"]',
  );
  const maybeStatus = document.querySelector<HTMLElement>(
    '[data-role="status"]',
  );
  if (!maybeToggle || !maybeOpenOptions || !maybeStatus) {
    return;
  }
  const toggle = maybeToggle;
  const status = maybeStatus;

  void settingsItem
    .getValue()
    .then((storedSettings) => {
      toggle.checked = normalizeSettings(storedSettings).enabled;
    })
    .catch(() => {
      status.textContent = t("optionsErrorLoadFailed");
    });

  // Storage rather than this checkbox is what the state follows: the settings
  // page and the timeline's toolbar can both change it while this popup is up.
  settingsItem.watch((storedSettings) => {
    toggle.checked = normalizeSettings(storedSettings).enabled;
  });

  toggle.addEventListener("change", () => {
    void settingsItem
      .getValue()
      .then((storedSettings) =>
        settingsItem.setValue(
          normalizeSettings({ ...storedSettings, enabled: toggle.checked }),
        ),
      )
      .catch(() => {
        status.textContent = t("optionsErrorSaveFailed");
      });
  });

  maybeOpenOptions.addEventListener("click", () => {
    // Chrome closes the popup on its own once the page is open. Whether that
    // page is a tab or the embedded pane is options_ui's to decide, and
    // entrypoints/options/index.html asks for a tab.
    void browser.runtime.openOptionsPage();
  });
}

main();
