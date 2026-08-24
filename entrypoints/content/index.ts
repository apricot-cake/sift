import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { selectAdapter } from "../../utils/adapters/index.ts";
import type { ServiceAdapter } from "../../utils/adapters/types.ts";
import {
  type ContinuousLoadObservation,
  ContinuousLoadWarningTracker,
} from "../../utils/continuous-load-warning.ts";
import { DEV_CONTENT_STARTED, DEV_FILTER_PASS } from "../../utils/dev-link.ts";
import { startUncaughtReporting } from "../../utils/error-log.ts";
import {
  type FilterContextResponse,
  isFilterContextRequest,
} from "../../utils/filter-context.ts";
import {
  type ClassifyReason,
  type ClassifyState,
  classifyPost,
} from "../../utils/filter-core.ts";
import { CONTENT_RUNTIME_KEY } from "../../utils/runtime-key.ts";
import {
  defaults,
  normalizeSettings,
  type Settings,
  settingsFor,
  thresholdsFor,
} from "../../utils/settings.ts";
import { settingsItem } from "../../utils/settings-storage.ts";
import { SITE_MATCHES } from "../../utils/site-matches.ts";
import {
  isTimelineControlRequest,
  TIMELINE_CONTROL,
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
  let keepViewportOnNextFilter = false;
  let disposed = false;
  let reportedFilterPass = false;
  let pageFilteringEnabled = false;
  const loadWarningTracker = adapter.readPostId
    ? new ContinuousLoadWarningTracker()
    : null;
  let observedPageKey = pageKey();

  function filteringEnabled(): boolean {
    return pageFilteringEnabled;
  }

  function pageKey(): string {
    const scope = adapter.settingsScope(document, location);
    return `${location.origin}${location.pathname}${location.search}#${scope?.key ?? "default"}`;
  }

  // 画像と動画のどちらを絞り込むかは読み手の設定なので、2つはアダプターから
  // 別々に届き、ここで畳み合わされる。`all` は本文だけの投稿も通す。
  function selectedSiteSettings() {
    const scope = adapter.settingsScope(document, location);
    return settingsFor(settings, adapter.settingsKey, scope?.key);
  }

  function matchesMediaFilter(
    postCard: Element,
    siteSettings: ReturnType<typeof selectedSiteSettings>,
  ): boolean {
    const { hasImage, hasVideo } = adapter.readMedia(postCard);
    if (siteSettings.kind === "metric" || !siteSettings.mediaEnabled) {
      return true;
    }
    const mediaMode = siteSettings.mediaMode;
    if (mediaMode === "all") {
      return true;
    }
    if (mediaMode === "images") {
      return hasImage;
    }
    if (mediaMode === "video") {
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

  function readCurrentPostIds(): string[] {
    if (!adapter.readPostId) {
      return [];
    }
    return adapter
      .getPostCards(document)
      .map((postCard) => adapter.readPostId?.(postCard) ?? null)
      .filter((id): id is string => id !== null);
  }

  // CSS の scroll anchoring はページ側がどの投稿をアンカーにするかで結果が変わる。
  // 抽出の切替は投稿をまとめて display:none にするので、ここでは読んでいた投稿を
  // 明示的に選ぶ。切替後にも残る、画面上端に最も近い投稿をその位置へ戻す。
  function findViewportAnchor(
    updates: readonly { cell: HTMLElement; state: ClassifyState | null }[],
  ): { cell: HTMLElement; top: number } | null {
    let beforeViewport: { cell: HTMLElement; top: number } | null = null;
    let afterViewport: { cell: HTMLElement; top: number } | null = null;

    for (const update of updates) {
      if (update.state === "hidden") {
        continue;
      }

      const { top, bottom } = update.cell.getBoundingClientRect();
      if (bottom <= 0 || top >= window.innerHeight) {
        continue;
      }
      if (top <= 0 && (!beforeViewport || top > beforeViewport.top)) {
        beforeViewport = { cell: update.cell, top };
      } else if (top > 0 && (!afterViewport || top < afterViewport.top)) {
        afterViewport = { cell: update.cell, top };
      }
    }

    return beforeViewport ?? afterViewport;
  }

  function restoreViewportAnchor(
    anchor: { cell: HTMLElement; top: number } | null,
  ): void {
    if (!anchor) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (disposed || !anchor.cell.isConnected) {
        return;
      }
      const offset = anchor.cell.getBoundingClientRect().top - anchor.top;
      if (offset !== 0) {
        window.scrollBy({ top: offset, behavior: "instant" });
      }
    });
  }

  function filterVisiblePosts(): void {
    filterFrame = null;
    if (disposed) {
      return;
    }

    const scope = adapter.settingsScope(document, location);
    const timelineAvailable = adapter.isTimelineAvailable(document, location);
    if (!timelineAvailable && scope === null) {
      clearTimelineState();
      return;
    }

    const postCards = adapter.getPostCards(document);
    if (postCards.length === 0) {
      clearAllFiltering();
      return;
    }

    const counts = { visible: 0, matched: 0, hidden: 0 };
    const siteSettings = selectedSiteSettings();
    const loadObservations: ContinuousLoadObservation[] = [];
    const updates: {
      cell: HTMLElement;
      state: ClassifyState | null;
      reason: ClassifyReason | null;
    }[] = [];

    for (const postCard of postCards) {
      // 生きたページ上の投稿は必ず HTMLElement。アダプターの約束が Element
      // までなのは、そこまでしか読まないから。
      const cell = adapter.findPostCell(postCard) as HTMLElement;
      const createdAtMs = adapter.readCreatedAt(postCard);

      if (!filteringEnabled()) {
        updates.push({
          cell,
          state: null,
          reason: null,
        });
        continue;
      }

      const result = classifyPost(
        {
          mediaMatches: matchesMediaFilter(postCard, siteSettings),
          metricCount: adapter.readMetricCount(postCard),
          createdAtMs,
          isRepost: adapter.readIsRepost(postCard),
          text: adapter.readText(postCard),
        },
        thresholdsFor(siteSettings),
      );

      updates.push({
        cell,
        state: result.state,
        reason: result.reason,
      });
      counts[result.state] += 1;
      const postId = adapter.readPostId?.(postCard);
      if (postId) {
        loadObservations.push({ id: postId, state: result.state });
      }
    }

    loadWarningTracker?.observe(loadObservations);

    const viewportAnchor = keepViewportOnNextFilter
      ? findViewportAnchor(updates)
      : null;
    keepViewportOnNextFilter = false;

    for (const update of updates) {
      if (update.state === null || update.reason === null) {
        clearCellState(update.cell);
      } else {
        setCellState(update.cell, update.state, update.reason);
      }
    }
    restoreViewportAnchor(viewportAnchor);

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
    for (const cell of document.querySelectorAll<HTMLElement>(
      "[data-sift-filter-state]",
    )) {
      clearCellState(cell);
    }
  }

  function clearTimelineState(): void {
    loadWarningTracker?.reset();
    clearAllFiltering();
  }

  function handleRoute(): void {
    const nextPageKey = pageKey();
    if (nextPageKey !== observedPageKey) {
      observedPageKey = nextPageKey;
      loadWarningTracker?.reset(readCurrentPostIds());
    }
    if (adapter.isTimelineAvailable(document, location)) {
      scheduleFilter();
    } else {
      clearTimelineState();
    }
  }

  function setFiltering(enabled: boolean): void {
    if (pageFilteringEnabled === enabled) {
      return;
    }
    pageFilteringEnabled = enabled;
    loadWarningTracker?.reset(readCurrentPostIds());
    keepViewportOnNextFilter = true;
    if (adapter.isTimelineAvailable(document, location)) {
      scheduleFilter();
    } else {
      clearTimelineState();
    }
  }

  async function handleTimelineControlMessage(
    message: unknown,
  ): Promise<FilterContextResponse | undefined> {
    if (isFilterContextRequest(message)) {
      const scope = adapter.isTimelineAvailable(document, location)
        ? adapter.settingsScope(document, location)
        : null;
      return {
        site: adapter.settingsKey,
        scopeKey: scope?.key ?? null,
        scopeKind: scope?.kind ?? null,
        pageTitle: document.title,
        pageKey: pageKey(),
        filteringEnabled: filteringEnabled(),
        continuousLoadingWarning:
          filteringEnabled() && (loadWarningTracker?.warning ?? false),
      };
    }
    if (!isTimelineControlRequest(message)) {
      return undefined;
    }
    if (
      message.type === TIMELINE_CONTROL.setFiltering &&
      typeof message.enabled === "boolean"
    ) {
      setFiltering(message.enabled);
    }
    return undefined;
  }

  // 設定は1つの値として保管されているので、丸ごと来る＝この実行環境が既に
  // 持っていたものへ差分を戻す作業は無い。
  function handleSettingsChange(storedSettings: Settings | null): void {
    if (disposed) {
      return;
    }

    settings = normalizeSettings(storedSettings);
    loadWarningTracker?.reset(readCurrentPostIds());
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
    window.removeEventListener("wheel", handleUserNavigation, true);
    window.removeEventListener("touchstart", handleUserNavigation, true);
    window.removeEventListener("pointerdown", handleUserNavigation, true);
    window.removeEventListener("keydown", handleUserNavigation, true);
    loadWarningTracker?.dispose();
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

  function handleUserNavigation(event: Event): void {
    if (!event.isTrusted) {
      return;
    }
    if (
      event instanceof KeyboardEvent &&
      ![
        "ArrowDown",
        "ArrowUp",
        "End",
        "Home",
        "PageDown",
        "PageUp",
        " ",
      ].includes(event.key)
    ) {
      return;
    }
    if (filteringEnabled()) {
      loadWarningTracker?.reset(readCurrentPostIds());
    }
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
      // 拡張機能のコンテキストが差し替わった可能性がある。監視は始めず、次の
      // 注入に任せる。
    });

  const unwatchSettings = settingsItem.watch(handleSettingsChange);
  browser.runtime.onMessage.addListener(handleTimelineControlMessage);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("wheel", handleUserNavigation, {
    capture: true,
    passive: true,
  });
  window.addEventListener("touchstart", handleUserNavigation, {
    capture: true,
    passive: true,
  });
  window.addEventListener("pointerdown", handleUserNavigation, true);
  window.addEventListener("keydown", handleUserNavigation, true);

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
      // Misskey はホストをアダプターの外で登録するため、振り分けにページ自身も渡す。
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
