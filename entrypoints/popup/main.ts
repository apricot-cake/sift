import { browser } from "wxt/browser";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import {
  addInstance,
  type InstanceDeps,
  normalizeInstanceHost,
  removeInstance,
} from "../../utils/instances.ts";
import { normalizeSettings, type Settings } from "../../utils/settings.ts";
import { instanceStorage, settingsItem } from "../../utils/settings-storage.ts";

// Everything running on this page is the extension's own, so nothing is
// filtered out. The subscription lives as long as the popup does.
startUncaughtReporting({
  target: window,
  source: "popup",
  filterToOwnCode: false,
});

// Wrapped in a function, rather than left at module top level, so a markup
// element that failed to resolve can early-return instead of throwing partway
// through — see the null check right below. The elements themselves are
// always present at runtime (popup.html declares every one of them), so the
// early return never actually fires.
function main(): void {
  const maybeStatus = document.querySelector<HTMLElement>(
    '[data-role="status"]',
  );
  const maybeInstanceList = document.querySelector<HTMLElement>(
    '[data-role="instance-list"]',
  );
  const maybeInstanceForm = document.querySelector<HTMLFormElement>(
    '[data-role="instance-form"]',
  );
  const maybeInstanceInput = document.querySelector<HTMLInputElement>(
    '[data-role="instance-input"]',
  );
  const maybeInstanceError = document.querySelector<HTMLElement>(
    '[data-role="instance-error"]',
  );
  if (
    !maybeStatus ||
    !maybeInstanceList ||
    !maybeInstanceForm ||
    !maybeInstanceInput ||
    !maybeInstanceError
  ) {
    return;
  }
  // Reassigned into fresh, never-reassigned consts so the functions declared
  // below keep the non-null narrowing — TS does not carry a variable's
  // narrowing into hoisted function declarations on its own.
  const status = maybeStatus;
  const instanceList = maybeInstanceList;
  const instanceForm = maybeInstanceForm;
  const instanceInput = maybeInstanceInput;
  const instanceError = maybeInstanceError;

  const instanceDeps: InstanceDeps = {
    permissions: browser.permissions,
    scripting: browser.scripting,
    storage: instanceStorage,
  };
  let settings = normalizeSettings(defaults);
  let statusTimer: number | null = null;

  function syncForm(): void {
    for (const element of document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("[data-setting]")) {
      const key = element.dataset.setting as keyof Settings;
      if (element instanceof HTMLInputElement && element.type === "checkbox") {
        element.checked = Boolean(settings[key]);
      } else {
        element.value = String(settings[key]);
      }
    }
  }

  function showSavedStatus(): void {
    status.textContent = "保存しました";
    if (statusTimer !== null) {
      window.clearTimeout(statusTimer);
    }
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 1400);
  }

  function renderInstances(): void {
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
  async function refreshInstances(): Promise<void> {
    settings = normalizeSettings(await settingsItem.getValue());
    renderInstances();
  }

  void settingsItem
    .getValue()
    .then((storedSettings) => {
      settings = normalizeSettings(storedSettings);
      syncForm();
      renderInstances();
      status.textContent = "";
    })
    .catch(() => {
      status.textContent = "設定を読み込めませんでした。";
    });

  // Storage, not the addInstance() call's own return value, is what drives the
  // list: the backstop in the background entrypoint (handlePermissionsAdded)
  // can finish writing the host after this popup's own addInstance() call was
  // torn down along with the popup that made it (Chrome does that the instant
  // the permission dialog appears). This listener is what shows the addition
  // once that happens, since nothing in this document survived to call
  // refreshInstances() itself.
  settingsItem.watch((storedSettings) => {
    settings = normalizeSettings(storedSettings);
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

    const submitButton = instanceForm.querySelector<HTMLButtonElement>(
      "button[type=submit]",
    );
    if (!submitButton) {
      return;
    }
    submitButton.disabled = true;
    try {
      const result = await addInstance(host, instanceDeps);
      if (!result.added) {
        instanceError.textContent =
          "権限が許可されなかったため、追加していません。";
        return;
      }
      instanceInput.value = "";
      await refreshInstances();
    } finally {
      submitButton.disabled = false;
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target as Element | null;
    const element = target?.closest("[data-setting]");
    if (
      !element ||
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement
      )
    ) {
      return;
    }

    const rawValue =
      element instanceof HTMLInputElement && element.type === "checkbox"
        ? element.checked
        : element.value;
    const key = element.dataset.setting as keyof Settings;
    settings = normalizeSettings({
      ...settings,
      [key]: rawValue,
    });

    void settingsItem
      .setValue(settings)
      .then(showSavedStatus)
      .catch(() => {
        status.textContent = "設定を保存できませんでした。";
      });
    syncForm();
  });
}

main();
