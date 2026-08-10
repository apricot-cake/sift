import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { selectAdapter } from "../../utils/adapters/index.ts";
import type { ServiceAdapter } from "../../utils/adapters/types.ts";
import { DEV_CONTENT_STARTED, DEV_FILTER_PASS } from "../../utils/dev-link.ts";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import {
  type ClassifyReason,
  type ClassifyState,
  classifyPost,
} from "../../utils/filter-core.ts";
import { CONTENT_RUNTIME_KEY } from "../../utils/runtime-key.ts";
import {
  defaults,
  isSiteEnabled,
  normalizeSettings,
  type Settings,
  thresholdsFor,
  withSiteEnabled,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { SITE_MATCHES } from "../../utils/site-matches.ts";
import {
  isTimelineControlRequest,
  TIMELINE_CONTROL,
  type TimelineControlState,
} from "../../utils/timeline-controls.ts";
import "./style.css";

export function startContentRuntime(
  _ctx: ContentScriptContext,
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
  let disposed = false;
  let reportedFilterPass = false;

  function filteringEnabled(): boolean {
    return isSiteEnabled(settings, location.hostname);
  }

  // 画像と動画のどちらをメディアと数えるかは読み手の設定なので、2つは
  // アダプターから別々に届き、ここで畳み合わされる。
  function hasMedia(postCard: Element): boolean {
    const { hasImage, hasVideo } = adapter.readMedia(postCard);
    if (settings.mediaMode === "images") {
      return hasImage;
    }
    if (settings.mediaMode === "video") {
      return hasVideo;
    }
    return hasImage || hasVideo;
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

  function filterVisiblePosts(): void {
    filterFrame = null;
    if (disposed) {
      return;
    }

    const postCards = adapter.getPostCards(document);
    if (postCards.length === 0) {
      clearTimelineState();
      return;
    }

    document.body.classList.toggle("sift-show-all", showAllTemporarily);

    const counts = { hit: 0, rising: 0, hidden: 0 };

    for (const postCard of postCards) {
      // 生きたページ上の投稿は必ず HTMLElement。アダプターの約束が Element
      // までなのは、そこまでしか読まないから。
      const cell = adapter.findPostCell(postCard) as HTMLElement;

      if (!filteringEnabled()) {
        clearCellState(cell);
        continue;
      }

      const result = classifyPost(
        {
          hasMedia: hasMedia(postCard),
          likeCount: adapter.readReactionCount(postCard),
          createdAtMs: adapter.readCreatedAt(postCard),
          isRepost: adapter.readIsRepost(postCard),
          text: adapter.readText(postCard),
        },
        // その数をどの数と比べるかはサービスの話で、この繰り返しの話では
        // ない＝Misskey のリアクションは専用の組を持つ。
        thresholdsFor(settings, adapter.thresholdKeys),
      );

      setCellState(cell, result.state, result.reason);
      counts[result.state] += 1;
    }

    // 実行環境につき1回、最初の一巡が何をしたかを開発時の worker へ伝える。
    // utils/dev-link.ts を参照＝門と一緒にリリースから落とされる。
    if (__SIFT_DEV__ && !reportedFilterPass) {
      reportedFilterPass = true;
      browser.runtime
        .sendMessage({
          type: DEV_FILTER_PASS,
          counts,
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

  function clearTimelineState(): void {
    showAllTemporarily = false;
    clearAllFiltering();
  }

  function handleRoute(): void {
    if (adapter.hasPostCards(document)) {
      scheduleFilter();
    } else {
      clearTimelineState();
    }
  }

  function timelineState(): TimelineControlState {
    return {
      timelineAvailable: adapter.hasPostCards(document),
      filteringEnabled: filteringEnabled(),
      showAllTemporarily,
    };
  }

  function toggleFiltering(): TimelineControlState {
    if (!adapter.hasPostCards(document)) {
      return timelineState();
    }

    settings = withSiteEnabled(
      settings,
      location.hostname,
      !filteringEnabled(),
    );
    if (!filteringEnabled()) {
      showAllTemporarily = false;
    }
    scheduleFilter();
    void settingsItem.setValue(settings).catch(() => {});
    return timelineState();
  }

  function toggleShowAll(): TimelineControlState {
    if (adapter.hasPostCards(document) && filteringEnabled()) {
      showAllTemporarily = !showAllTemporarily;
      scheduleFilter();
    }
    return timelineState();
  }

  function handleTimelineControlMessage(
    message: unknown,
  ): TimelineControlState | undefined {
    if (!isTimelineControlRequest(message)) {
      return undefined;
    }
    if (message.type === TIMELINE_CONTROL.toggleFiltering) {
      return toggleFiltering();
    }
    if (message.type === TIMELINE_CONTROL.toggleShowAll) {
      return toggleShowAll();
    }
    return timelineState();
  }

  // 設定は1つの値として保管されているので、丸ごと来る＝この実行環境が既に
  // 持っていたものへ差分を戻す作業は無い。
  function handleSettingsChange(storedSettings: Settings | null): void {
    if (disposed) {
      return;
    }

    settings = normalizeSettings(storedSettings);
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
    browser.runtime.onMessage.removeListener(handleTimelineControlMessage);
    stopUncaughtReporting();
    try {
      unwatchSettings();
    } catch {
      // 拡張機能のコンテキストが既に無効になっているかもしれない。
    }
    clearTimelineState();
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

  const unwatchSettings = settingsItem.watch(handleSettingsChange);
  browser.runtime.onMessage.addListener(handleTimelineControlMessage);
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
    // 同じ投稿を二重にフィルタする。
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
