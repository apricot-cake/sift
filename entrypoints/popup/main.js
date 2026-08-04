import { startUncaughtReporting } from "../../utils/error-log.js";
import {
  MISSKEY_INSTANCES_KEY,
  addInstance,
  normalizeInstanceHost,
  removeInstance
} from "../../utils/instances.js";
import { defaults, normalizeSettings } from "../../utils/settings.js";

// Everything running on this page is the extension's own, so nothing is
// filtered out. The subscription lives as long as the popup does.
startUncaughtReporting({
  target: window,
  source: "popup",
  filterToOwnCode: false
});

const status = document.querySelector('[data-role="status"]');
const instanceList = document.querySelector('[data-role="instance-list"]');
const instanceForm = document.querySelector('[data-role="instance-form"]');
const instanceInput = document.querySelector('[data-role="instance-input"]');
const instanceError = document.querySelector('[data-role="instance-error"]');
const instanceDeps = {
  permissions: chrome.permissions,
  scripting: chrome.scripting,
  storage: chrome.storage
};
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

function renderInstances() {
  instanceList.innerHTML = "";

  for (const host of settings.misskeyInstances) {
    const item = document.createElement("li");
    item.className = "instance-row";

    const label = document.createElement("span");
    label.textContent = host;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "削除";
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      await removeInstance(host, instanceDeps);
      await refreshInstances();
    });

    item.append(label, removeButton);
    instanceList.append(item);
  }
}

// Re-reads storage rather than patching `settings.misskeyInstances` locally:
// addInstance()/removeInstance() are the source of truth for what actually
// got registered, and this popup is not the only surface that can change it
// (chrome://extensions can revoke a permission out from under it).
async function refreshInstances() {
  settings = normalizeSettings(await chrome.storage.sync.get(defaults));
  renderInstances();
}

chrome.storage.sync.get(defaults, (storedSettings) => {
  settings = normalizeSettings(storedSettings);
  syncForm();
  renderInstances();
  status.textContent = "";
});

// Storage, not the addInstance() call's own return value, is what drives the
// list: the backstop in the background entrypoint (handlePermissionsAdded)
// can finish writing the host after this popup's own addInstance() call was
// torn down along with the popup that made it (Chrome does that the instant
// the permission dialog appears). This listener is what shows the addition
// once that happens, since nothing in this document survived to call
// refreshInstances() itself.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !(MISSKEY_INSTANCES_KEY in changes)) {
    return;
  }
  settings = normalizeSettings({ ...settings, misskeyInstances: changes[MISSKEY_INSTANCES_KEY].newValue });
  renderInstances();
});

instanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  instanceError.textContent = "";

  const host = normalizeInstanceHost(instanceInput.value);
  if (host === null) {
    instanceError.textContent =
      "ホスト名を確認してください（例: misskey.io。パスやクエリ、httpは指定できません）。";
    return;
  }

  const submitButton = instanceForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  try {
    const result = await addInstance(host, instanceDeps);
    if (!result.added) {
      instanceError.textContent = "権限が許可されなかったため、追加していません。";
      return;
    }
    instanceInput.value = "";
    await refreshInstances();
  } finally {
    submitButton.disabled = false;
  }
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
