import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from "wxt/utils/content-script-ui/shadow-root";
import { selectAdapter } from "../../utils/adapters/index.ts";
import type { ServiceAdapter } from "../../utils/adapters/types.ts";
import { DEV_CONTENT_STARTED, DEV_FILTER_PASS } from "../../utils/dev-link.ts";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import {
  type ClassifyReason,
  type ClassifyState,
  classifyPost,
} from "../../utils/filter-core.ts";
import { t } from "../../utils/i18n.ts";
import { CONTENT_RUNTIME_KEY } from "../../utils/runtime-key.ts";
import {
  defaults,
  normalizeSettings,
  type Settings,
  type ThresholdKey,
  thresholdsFor,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { SITE_MATCHES } from "../../utils/site-matches.ts";
import "./style.css";

// WXT が shadow root を載せるカスタム要素。ケバブケースであることが要る。
// この行から下は全部その shadow root の中で、TOOLBAR_CSS もそこに含まれる＝
// ホスト自身の置き場所がそこに書いてあるのは、entrypoints/content/style.css の
// 外側の規則が、WXT がここへ入れるものに負けるから。
const TOOLBAR_TAG = "sift-toolbar";

// ツールバー自身のスタイル。shadow root で隔ててある。マークアップへ書き込まず
// WXT へ渡しているのは両者を切り離せるようにするためで、
// entrypoints/content/style.css へ入れていないのは、あのスタイルシートがページ
// そのものへ注入されるから＝ここのどれもそこへ届いてはならない。
//
// ツールバーの置き場所はここにある。あのスタイルシートではない。そして
// `all: initial` は WXT に任せず手で書いてある。任せると WXT はこれの先頭へ
// `:host{all:initial !important}` を足す＝!important はその下の宣言全部に勝つ
// ので、ホストはページの流れの中の `position: static` へ戻り、タイムラインの
// 途中に落ちる（2026-08-08 に x.com/home で確認）。それを止めるのが
// `inheritStyles: true`。打ち消し自体は今も欲しいし、今も先頭に置く。あっては
// ならないのは、その直後の規則から勝てないことの方。
const TOOLBAR_CSS = `
  :host {
    all: initial;
    bottom: 18px;
    color-scheme: light dark;
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
    position: fixed;
    right: 18px;
    z-index: 2147483647;
    --accent: #0f6cbd;
    --background: #ffffff;
    --border: #d1d5db;
    --control-background: #ffffff;
    --foreground: #1f2328;
    --muted: #656d76;
    --subtle-background: #f6f8fa;
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --accent: #4c9ee8;
      --background: #202020;
      --border: #484848;
      --control-background: #292929;
      --foreground: #f3f3f3;
      --muted: #b7b7b7;
      --subtle-background: #2b2b2b;
    }
  }
  * { box-sizing: border-box; }
  .toolbar { align-items: center; background: var(--background); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 14px rgb(0 0 0 / 18%); color: var(--foreground); display: flex; gap: 6px; padding: 7px; }
  button { background: var(--control-background); border: 1px solid var(--border); border-radius: 6px; color: inherit; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; min-height: 30px; padding: 5px 9px; white-space: nowrap; }
  button:hover { background: var(--subtle-background); }
  button:focus-visible, input:focus-visible, select:focus-visible { border-color: var(--accent); outline: 2px solid color-mix(in srgb, var(--accent) 40%, transparent); outline-offset: 1px; }
  button[data-active="true"] { background: var(--accent); border-color: var(--accent); color: #ffffff; }
  .status { font-size: 12px; font-variant-numeric: tabular-nums; padding: 0 4px; white-space: nowrap; }
  .panel { background: var(--background); border: 1px solid var(--border); border-radius: 8px; bottom: 48px; box-shadow: 0 8px 24px rgb(0 0 0 / 22%); color: var(--foreground); min-width: 292px; padding: 14px; position: absolute; right: 0; }
  .panel[hidden] { display: none; }
  .panel-header { align-items: baseline; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; margin-bottom: 7px; padding-bottom: 10px; }
  .panel-header strong { font-size: 14px; font-weight: 600; }
  .panel-header span { color: var(--muted); font-size: 11px; }
  label { align-items: center; display: flex; font-size: 13px; gap: 12px; justify-content: space-between; min-height: 36px; }
  input, select { font: inherit; }
  input[type="checkbox"] { accent-color: var(--accent); height: 17px; width: 17px; }
  input[type="number"], select { background: var(--control-background); border: 1px solid var(--border); border-radius: 6px; color: var(--foreground); height: 30px; padding: 4px 7px; width: 96px; }
  .input-with-unit { align-items: center; color: var(--muted); display: flex; font-size: 11px; gap: 5px; }
  .input-with-unit input { width: 66px; }
  .hint { border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; line-height: 1.45; margin: 8px 0 0; padding-top: 10px; }
`;

export function startContentRuntime(
  ctx: ContentScriptContext,
  maybeAdapter: ServiceAdapter | null,
) {
  // ここには読むものが無い。それでも実行環境が dispose() に答えるのは、呼び出し
  // 側が「始まったかどうか」を知らずに済むように。
  if (!maybeAdapter) {
    return { dispose() {} };
  }
  // 一度も代入し直されない新しい const へ入れ直してあるのは、下で宣言する関数が
  // null でないという絞り込みを保てるように＝TS は引数の絞り込みを、巻き上げ
  // られた関数宣言の中まで自分では運ばない。
  const adapter = maybeAdapter;

  // 世界の寿命ではなく、この実行環境の寿命に結び付けてある＝このスクリプトを
  // 差し替える注入は先に前の実行環境を片付けるので、両方が購読している時間は
  // 存在しない。
  const stopUncaughtReporting = startUncaughtReporting({
    target: window,
    source: "content",
    // X 自身の例外もこの同じ window に届き、それを記録すれば誤報になる。Sift の
    // ものは、拡張機能のオリジンを名乗るフレームだけ。
    filterToOwnCode: true,
  });

  let settings = normalizeSettings(defaults);
  let observer: MutationObserver | null = null;
  let routeTimer: number | null = null;
  let filterFrame: number | null = null;
  let showAllTemporarily = false;
  // ホストの要素・shadow root・その中の入れ物を作るのは WXT。`toolbar` は
  // それができた後のその UI＝作られるのは非同期なので、載せる先ができる前に
  // 最初のフィルタの一巡が走りうる。
  let toolbar: ShadowRootContentScriptUi<void> | null = null;
  let toolbarMounted = false;
  let disposed = false;
  let reportedFilterPass = false;

  // ツールバーが画面に出ている間、その要素がどこにあるか。それを読み書きする
  // ものは全部ここを通す＝載せ替えをまたいで入れ物を持ち続けない。WXT は外す
  // ときにそれを空にし、次に載せるときは新しいものを埋める。
  function toolbarRoot(): ParentNode | null {
    return toolbarMounted && toolbar ? toolbar.uiContainer : null;
  }

  // 画像と動画のどちらをメディアと数えるかは読み手の設定なので、2つは
  // アダプターから別々に届き、ここで畳み合わされる。
  function hasMedia(postCard: Element): boolean {
    const { hasImage, hasVideo } = adapter.readMedia(postCard);
    return settings.mediaMode === "images" ? hasImage : hasImage || hasVideo;
  }

  function setCellState(
    cell: HTMLElement,
    state: ClassifyState,
    reason: ClassifyReason,
  ): void {
    cell.dataset.siftFilterState = state;
    cell.dataset.siftFilterReason = reason;
  }

  function clearCellState(cell: HTMLElement): void {
    delete cell.dataset.siftFilterState;
    delete cell.dataset.siftFilterReason;
  }

  function updateToolbarCounts(counts: {
    hit: number;
    rising: number;
    hidden: number;
  }): void {
    const root = toolbarRoot();
    if (!root) {
      return;
    }

    const status = root.querySelector<HTMLElement>('[data-role="status"]');
    const toggle = root.querySelector<HTMLElement>(
      '[data-action="toggle-enabled"]',
    );
    const reveal = root.querySelector<HTMLElement>(
      '[data-action="toggle-show-all"]',
    );

    if (status) {
      status.textContent = settings.enabled
        ? t("toolbarStatusCounts", [
            t("toolbarHitCount", counts.hit),
            t("toolbarRisingCount", counts.rising),
            t("toolbarHiddenCount", counts.hidden),
          ])
        : t("toolbarStatusStopped");
    }
    if (toggle) {
      toggle.textContent = settings.enabled
        ? t("toolbarFilterOn")
        : t("toolbarFilterOff");
      toggle.dataset.active = String(settings.enabled);
    }
    if (reveal) {
      reveal.textContent = showAllTemporarily
        ? t("toolbarShowFiltered")
        : t("toolbarShowAll");
    }
  }

  function filterVisiblePosts(): void {
    filterFrame = null;
    if (disposed) {
      return;
    }

    const postCards = adapter.getPostCards(document);
    if (postCards.length === 0) {
      unmountToolbar();
      return;
    }

    mountToolbar();
    document.body.classList.toggle("sift-show-all", showAllTemporarily);

    const counts = { hit: 0, rising: 0, hidden: 0 };

    for (const postCard of postCards) {
      // 生きたページ上の投稿は必ず HTMLElement。アダプターの約束が Element
      // までなのは、そこまでしか読まないから。
      const cell = adapter.findPostCell(postCard) as HTMLElement;

      if (!settings.enabled) {
        clearCellState(cell);
        continue;
      }

      const result = classifyPost(
        {
          hasMedia: hasMedia(postCard),
          likeCount: adapter.readReactionCount(postCard),
          createdAtMs: adapter.readCreatedAt(postCard),
          isRepost: adapter.readIsRepost(postCard),
        },
        // その数をどの数と比べるかはサービスの話で、この繰り返しの話では
        // ない＝Misskey のリアクションは専用の組を持つ。
        thresholdsFor(settings, adapter.thresholdKeys),
      );

      setCellState(cell, result.state, result.reason);
      counts[result.state] += 1;
    }

    updateToolbarCounts(counts);

    // 実行環境につき1回、最初の一巡が何をしたかを開発時の worker へ伝える。
    // utils/dev-link.ts を参照＝門と一緒にリリースから落とされる。
    if (__SIFT_DEV__ && !reportedFilterPass) {
      reportedFilterPass = true;
      browser.runtime
        .sendMessage({
          type: DEV_FILTER_PASS,
          counts,
          toolbar: toolbarMounted,
        })
        .catch(() => {});
    }
  }

  function scheduleFilter(): void {
    if (disposed || filterFrame !== null) {
      return;
    }
    filterFrame = window.requestAnimationFrame(filterVisiblePosts);
  }

  function clearAllFiltering(): void {
    document.body.classList.remove("sift-show-all");
    for (const cell of document.querySelectorAll<HTMLElement>(
      "[data-sift-filter-state]",
    )) {
      clearCellState(cell);
    }
  }

  function saveSettings(partialSettings: Partial<Settings>): void {
    const nextSettings = normalizeSettings({ ...settings, ...partialSettings });
    void settingsItem.setValue(nextSettings).catch(() => {
      // content script からはこれを報告する先が無いし、ツールバーは既に読み手が
      // 選んだ値を出している。書き込みが結局届いていたなら、下の watch が保管庫の
      // 実際の中身を読み直す。
    });
  }

  // しきい値の入力の矢印を1回押したときに動く幅。そのしきい値自身の既定値から
  // 導いてあるので、サービスの規模に釣り合ったままになる＝X のいいねは百の桁、
  // Misskey のリアクションは十の桁。
  function thresholdStep(key: ThresholdKey): number {
    return Math.max(1, Math.round(defaults[key] / 10));
  }

  function toolbarMarkup(): string {
    const { minReactions, risingMinReactions } = adapter.thresholdKeys;
    const { minCount, risingMinCount } = adapter.reactionLabels;
    return `
        <div class="panel" data-role="panel" role="dialog" aria-label="${t("toolbarPanelLabel")}" hidden>
          <div class="panel-header"><strong>${t("toolbarPanelTitle")}</strong><span>${t("toolbarAutosave")}</span></div>
          <label>${t(minCount)}<input data-setting="${minReactions}" type="number" min="0" step="${thresholdStep(minReactions)}"></label>
          <label>${t("toolbarRisingEnabled")}<input data-setting="risingEnabled" type="checkbox"></label>
          <label>${t(risingMinCount)}<input data-setting="${risingMinReactions}" type="number" min="0" step="${thresholdStep(risingMinReactions)}"></label>
          <label>${t("toolbarMaxAge")}<span class="input-with-unit"><input data-setting="risingMaxAgeHours" type="number" min="1" max="168">${t("toolbarUnitHours")}</span></label>
          <label>${t("toolbarMedia")}<select data-setting="mediaMode"><option value="any">${t("toolbarMediaAny")}</option><option value="images">${t("toolbarMediaImages")}</option></select></label>
          <label>${t("toolbarHideReposts")}<input data-setting="hideReposts" type="checkbox"></label>
          <p class="hint">${t("toolbarHint")}</p>
        </div>
        <div class="toolbar">
          <button data-action="toggle-enabled"></button><span class="status" data-role="status" role="status" aria-live="polite">${t("toolbarStatusChecking")}</span><button data-action="toggle-show-all">${t("toolbarShowAll")}</button><button data-action="toggle-panel" aria-expanded="false">${t("toolbarSettings")}</button>
        </div>
      `;
  }

  function syncToolbarForm(root: ParentNode | null = toolbarRoot()): void {
    if (!root) {
      return;
    }

    for (const element of root.querySelectorAll<
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

  function handleToolbarClick(event: Event): void {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLElement>("button[data-action]");
    if (!button) {
      return;
    }

    if (button.dataset.action === "toggle-enabled") {
      saveSettings({ enabled: !settings.enabled });
    } else if (button.dataset.action === "toggle-show-all") {
      showAllTemporarily = !showAllTemporarily;
      scheduleFilter();
    } else if (button.dataset.action === "toggle-panel") {
      const panel = toolbarRoot()?.querySelector<HTMLElement>(
        '[data-role="panel"]',
      );
      if (!panel) {
        return;
      }
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
    }
  }

  function handleToolbarChange(event: Event): void {
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

    const value =
      element instanceof HTMLInputElement && element.type === "checkbox"
        ? element.checked
        : element.value;
    const key = element.dataset.setting as keyof Settings;
    saveSettings({ [key]: value } as Partial<Settings>);
  }

  function mountToolbar(): void {
    if (
      disposed ||
      toolbar === null ||
      toolbarMounted ||
      !adapter.hasPostCards(document)
    ) {
      return;
    }

    toolbar.mount();
    toolbarMounted = true;
  }

  function unmountToolbar(): void {
    if (toolbarMounted) {
      toolbar?.remove();
      toolbarMounted = false;
    }
    showAllTemporarily = false;
    clearAllFiltering();
  }

  function handleRoute(): void {
    if (adapter.hasPostCards(document)) {
      scheduleFilter();
    } else {
      unmountToolbar();
    }
  }

  // 設定は1つの値として保管されているので、丸ごと来る＝この実行環境が既に
  // 持っていたものへ差分を戻す作業は無い。
  function handleSettingsChange(storedSettings: Settings | null): void {
    if (disposed) {
      return;
    }

    settings = normalizeSettings(storedSettings);
    syncToolbarForm();
    scheduleFilter();
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    observer?.disconnect();
    observer = null;
    if (routeTimer !== null) {
      window.clearInterval(routeTimer);
      routeTimer = null;
    }
    if (filterFrame !== null) {
      window.cancelAnimationFrame(filterFrame);
      filterFrame = null;
    }
    window.removeEventListener("pagehide", handlePageHide);
    stopUncaughtReporting();
    try {
      unwatchSettings();
    } catch {
      // 拡張機能のコンテキストが既に無効になっているかもしれない。
    }
    unmountToolbar();
  }

  function handlePageHide(): void {
    dispose();
  }

  void settingsItem
    .getValue()
    .then((storedSettings) => {
      if (disposed) {
        return;
      }

      settings = normalizeSettings(storedSettings);
      scheduleFilter();

      observer = new MutationObserver(scheduleFilter);
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });

      routeTimer = window.setInterval(handleRoute, 750);
    })
    .catch(() => {
      // 拡張機能のコンテキストが既に無効になっているかもしれない＝この実行環境が
      // 差し替えられている最中か、ページの足元で拡張機能が再読み込みされたか。
      // 起動時の既定値がそのまま残り、他には何も走らない。
    });

  // 作るのは一度きりで、ページが投稿を得たり失ったりするのに合わせて載せたり
  // 外したりする。この API は非同期＝content script が CSS をそのやり方で渡した
  // 場合、WXT はスタイルシートをネットワーク越しに取りに行く（これはそうして
  // いない）。だから見せるツールバーができる前に最初のフィルタの一巡が走りうる
  // ので、できた時点でここからもう一度頼む。
  void createShadowRootUi<void>(ctx, {
    name: TOOLBAR_TAG,
    // "inline" は、これがどこに座るかから WXT を外す＝置くのは TOOLBAR_CSS。
    // 他の2つ（"overlay"・"modal"）はホストへインラインのスタイルを書き、
    // 入れ物を画面いっぱいに広げる＝隅の箱1つとは別のもの。
    position: "inline",
    anchor: "body",
    css: TOOLBAR_CSS,
    // WXT が `:host{all:initial !important}` を先頭へ足すのを止める＝打ち消しは
    // TOOLBAR_CSS が自分でやっている。その後ろの規則を全部届かなくしていた
    // !important 抜きで。
    inheritStyles: true,
    onMount(container) {
      container.innerHTML = toolbarMarkup();
      syncToolbarForm(container);
      container.addEventListener("click", handleToolbarClick);
      container.addEventListener("change", handleToolbarChange);
    },
  })
    .then((ui) => {
      if (disposed) {
        ui.remove();
        return;
      }
      toolbar = ui;
      scheduleFilter();
    })
    .catch(() => {
      // フィルタはこれが無くても動く。失われるのは、ページ自身から設定を変える
      // 手段の方。
    });

  const unwatchSettings = settingsItem.watch(handleSettingsChange);
  window.addEventListener("pagehide", handlePageHide);

  return { dispose };
}

export default defineContentScript({
  matches: SITE_MATCHES,
  runAt: "document_idle",
  main(ctx) {
    // 注入し直し＝WXT の開発モードが、前の世代がまだ握っているタブへ新しい写しを
    // 注入すること。これはこのファイルを、古いリスナーと DOM をまだ抱えている
    // かもしれない領域でもう一度走らせる。入ってくる世代が出ていく世代を見つけ、
    // 先にそれを降ろすための手掛かりが、持ち主を示すシンボル。これが無いと2つが
    // 同じツールバーを二重に描き、両方が同じ投稿をフィルタする。
    //
    // globalThis は任意のシンボルに対する添字の型を持たない＝globalThis の型を
    // プロジェクト全体で広げるのではなく、この1箇所でだけ変換する。
    const runtimeSymbol = Symbol.for(CONTENT_RUNTIME_KEY);
    const runtimeGlobal = globalThis as unknown as Record<
      symbol,
      ReturnType<typeof startContentRuntime> | undefined
    >;
    runtimeGlobal[runtimeSymbol]?.dispose();
    runtimeGlobal[runtimeSymbol] = startContentRuntime(
      // WXT がこの注入にぶら下げるもの全部＝ツールバーの shadow root はこれに
      // 対して作られるので、それを作ったスクリプトと一緒に降りる。
      ctx,
      // ホストだけでなくページ自身も渡す＝Sift 向けに作られていないホストは、
      // 読み手が Misskey のインスタンスとして追加したものであり、それを確かめる
      // のはページの方（utils/adapters/index.ts）。
      selectAdapter(location.hostname, document),
    );

    // このページがスクリプトを受け取ったことを開発時の worker へ伝える。
    // 「拡張機能が実際にページに載っている」ことの証拠のうち、人がブラウザを
    // 見なくても読める唯一のもので、開発モードではこの問いにどちらの答えも
    // 現実にありうる（#31）。門と一緒にリリースから落とされる。経路だけを送る＝
    // ログファイルがクエリ文字列を抱える理由は無い。
    if (__SIFT_DEV__) {
      browser.runtime
        .sendMessage({
          type: DEV_CONTENT_STARTED,
          page: `${location.origin}${location.pathname}`,
        })
        .catch(() => {
          // それを聞ける worker が起きていない＝そしてそれを起こすことがこの
          // メッセージの目的。
        });
    }
  },
});
