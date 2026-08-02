import { startUncaughtReporting } from "../../utils/error-log.js";
import { defaults, normalizeSettings } from "../../utils/settings.js";

// Everything running on this page is the extension's own, so nothing is
// filtered out. The subscription lives as long as the popup does.
startUncaughtReporting({
  target: window,
  source: "popup",
  filterToOwnCode: false
});

const status = document.querySelector('[data-role="status"]');
let settings = normalizeSettings(defaults);
let statusTimer = null;

function syncForm() {
  for (const element of document.querySelectorAll("[data-setting]")) {
    const key = element.dataset.setting;
    if (element.type === "checkbox") {
      element.checked = Boolean(settings[key]);
    } else {
      element.value = String(settings[key]);
    }
  }
}

function showSavedStatus() {
  status.textContent = "保存しました";
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
  }
  statusTimer = window.setTimeout(() => {
    status.textContent = "";
  }, 1400);
}

chrome.storage.sync.get(defaults, (storedSettings) => {
  settings = normalizeSettings(storedSettings);
  syncForm();
  status.textContent = "";
});

document.addEventListener("change", (event) => {
  const element = event.target.closest("[data-setting]");
  if (!element) {
    return;
  }

  const rawValue = element.type === "checkbox" ? element.checked : element.value;
  settings = normalizeSettings({
    ...settings,
    [element.dataset.setting]: rawValue
  });

  chrome.storage.sync.set(settings, showSavedStatus);
  syncForm();
});
