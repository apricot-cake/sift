import { browser } from "wxt/browser";
import { DEFAULT_MISSKEY_HOSTS } from "../../utils/default-instances.ts";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import { localizeDocument, t } from "../../utils/i18n.ts";
import {
  addInstance,
  type InstanceDeps,
  normalizeInstanceHost,
  removeInstance,
} from "../../utils/instances.ts";
import { normalizeSettings, type Settings } from "../../utils/settings.ts";
import { instanceStorage, settingsItem } from "../../utils/settings-storage.ts";

// このページで動いているものは全部が拡張機能自身のものなので、何も除かない。
// 購読はページと同じだけ生きる。
startUncaughtReporting({
  target: window,
  source: "options",
  filterToOwnCode: false,
});

// モジュールの最上位に置かず関数で包んであるのは、見つからなかったマークアップの
// 要素があったときに、途中で例外を投げるのではなく早く返せるように＝すぐ下の
// null 検査。要素そのものは実行時に必ずある（index.html がどれも宣言している）
// ので、この早期の return が実際に走ることはない。
function main(): void {
  // ページから何かを読む前・ページに何かを見せる前に。index.html は文字が入る
  // 場所にメッセージ名を持って出荷され、その間の一瞬に読み手が見ることになるのが
  // 空の文書。
  localizeDocument(document);
  document.documentElement.lang = browser.i18n.getUILanguage();

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
  // 一度も代入し直されない新しい const へ入れ直してあるのは、下で宣言する関数が
  // null でないという絞り込みを保てるように＝TS は変数の絞り込みを、巻き上げ
  // られた関数宣言の中まで自分では運ばない。
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
    status.textContent = t("optionsStatusSaved");
    if (statusTimer !== null) {
      window.clearTimeout(statusTimer);
    }
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 1400);
  }

  function renderInstances(): void {
    instanceList.innerHTML = "";

    // misskey.io はビルド時に host_permissions へ静的に含めた既定のホスト
    // （#41）＝removeInstance() の permissions.remove() はここに効かないので、
    // 削除できるかのように見せない。バッジだけを添えて、一覧の先頭に固定で
    // 出す。
    for (const host of DEFAULT_MISSKEY_HOSTS) {
      const item = document.createElement("li");
      item.className = "instance-row";
      item.title = t("optionsInstanceDefaultHint");

      const label = document.createElement("span");
      label.textContent = host;

      const badge = document.createElement("span");
      badge.className = "instance-badge";
      badge.textContent = t("optionsInstanceDefault");

      item.append(label, badge);
      instanceList.append(item);
    }

    for (const host of settings.misskeyInstances) {
      // この機能より前に読み手が misskey.io を自分で追加していた保管庫を
      // 引き継いだ場合の受け皿＝上のループで既に出しているので、ここでは
      // 出さない。
      if (DEFAULT_MISSKEY_HOSTS.includes(host)) {
        continue;
      }

      const item = document.createElement("li");
      item.className = "instance-row";

      const label = document.createElement("span");
      label.textContent = host;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = t("optionsInstanceRemove");
      removeButton.addEventListener("click", async () => {
        removeButton.disabled = true;
        await removeInstance(host, instanceDeps);
        await refreshInstances();
      });

      item.append(label, removeButton);
      instanceList.append(item);
    }
  }

  // 手元で `settings.misskeyInstances` を繕わず、保管庫を読み直す＝実際に何が
  // 登録されたかの正本は addInstance() / removeInstance() の側だし、それを変え
  // られる画面はこのページだけではない（chrome://extensions が足元で権限を
  // 取り消せる）。
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
      status.textContent = t("optionsErrorLoadFailed");
    });

  // 一覧を動かすのは保管庫であって、addInstance() の呼び出しが返した値ではない。
  // タブの上ではこちらが普通の経路＝権限のダイアログが出てもページは立ったまま
  // で、addInstance() はそこへ戻ってくる。同時にこれは、設定がかつて置かれて
  // いた場所のための受け皿でもある＝ダイアログが出ると Chrome が壊す画面。
  // そこでは、壊された呼び出しが辿り着けなかった書き込みを background の
  // エントリポイントの handlePermissionsAdded が仕上げる（#28）。保管庫から
  // 一覧を読めば、自分がどちらの上にいるかを知らずに両方を賄える。
  settingsItem.watch((storedSettings) => {
    settings = normalizeSettings(storedSettings);
    renderInstances();
  });

  instanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    instanceError.textContent = "";

    const host = normalizeInstanceHost(instanceInput.value);
    if (host === null) {
      instanceError.textContent = t("optionsErrorBadHost");
      return;
    }
    if (DEFAULT_MISSKEY_HOSTS.includes(host)) {
      // 既に host_permissions で許可済み＝addInstance() へ回しても、既定の
      // 一覧が二重に出るだけの登録を増やす。
      instanceError.textContent = t("optionsErrorAlreadyDefault");
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
        instanceError.textContent = t("optionsErrorPermissionDenied");
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
        status.textContent = t("optionsErrorSaveFailed");
      });
    syncForm();
  });
}

main();
