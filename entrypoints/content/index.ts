import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { selectAdapter } from "../../utils/adapters/index.ts";
import type { ServiceAdapter } from "../../utils/adapters/types.ts";
import {
  type ContinuousLoadObservation,
  ContinuousLoadWarningTracker,
} from "../../utils/continuous-load-warning.ts";
import {
  type FilterContextResponse,
  isFilterContextRequest,
} from "../../utils/filter-context.ts";
import {
  type ClassifyReason,
  type ClassifyState,
  classifyPost,
} from "../../utils/filter-core.ts";
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

  let settings = normalizeSettings(defaults);
  let observer: MutationObserver | null = null;
  let routeTimer: number | null = null;
  let filterFrame: number | null = null;
  let layoutProbeFrame: number | null = null;
  let layoutProbeTimer: number | null = null;
  let scrollTopBeforeLayoutProbe: number | null = null;
  let layoutProbePausedByUser = false;
  let keepViewportOnNextFilter = false;
  let disposed = false;
  let pageFilteringEnabled = false;
  const loadWarningTracker = adapter.readPostId
    ? new ContinuousLoadWarningTracker()
    : null;
  let observedPageKey = pageKey();

  function filteringEnabled(): boolean {
    return pageFilteringEnabled;
  }

  function pageKey(): string {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  // 画像と動画のどちらを絞り込むかは読み手の設定なので、2つはアダプターから
  // 別々に届き、ここで畳み合わされる。`all` は本文だけの投稿も通す。
  function selectedSiteSettings() {
    return settingsFor(settings, adapter.settingsKey);
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

  function stopLayoutProbe(restoreScroll = true): void {
    if (layoutProbeFrame !== null) {
      window.cancelAnimationFrame(layoutProbeFrame);
      layoutProbeFrame = null;
    }
    if (layoutProbeTimer !== null) {
      window.clearTimeout(layoutProbeTimer);
      layoutProbeTimer = null;
    }
    document.documentElement.removeAttribute("data-sift-layout-probe");
    if (scrollTopBeforeLayoutProbe !== null) {
      const scrollTop = scrollTopBeforeLayoutProbe;
      scrollTopBeforeLayoutProbe = null;
      if (restoreScroll) {
        window.requestAnimationFrame(() => {
          if (!disposed) {
            window.scrollTo({ top: scrollTop, behavior: "instant" });
          }
        });
      }
    }
  }

  function startLayoutProbe(): void {
    if (
      disposed ||
      !adapter.needsLayoutProbeForPagination ||
      adapter.hasReachedTimelineEnd?.(document) ||
      layoutProbePausedByUser ||
      layoutProbeFrame !== null ||
      layoutProbeTimer !== null
    ) {
      return;
    }

    const scrollingElement =
      document.scrollingElement ?? document.documentElement;
    scrollTopBeforeLayoutProbe = scrollingElement.scrollTop;
    document.documentElement.setAttribute("data-sift-layout-probe", "");
    layoutProbeFrame = window.requestAnimationFrame(() => {
      layoutProbeFrame = null;
      if (disposed || !filteringEnabled()) {
        stopLayoutProbe();
        return;
      }
      window.scrollTo({
        top: scrollingElement.scrollHeight,
        behavior: "instant",
      });
      layoutProbeTimer = window.setTimeout(() => {
        layoutProbeTimer = null;
        stopLayoutProbe();
        scheduleFilter();
      }, 2_000);
    });
  }

  function isAtPageBottom(): boolean {
    const scrollingElement =
      document.scrollingElement ?? document.documentElement;
    return (
      scrollingElement.scrollHeight -
        scrollingElement.clientHeight -
        scrollingElement.scrollTop <=
      4
    );
  }

  function filterVisiblePosts(): void {
    filterFrame = null;
    if (disposed) {
      return;
    }

    const timelineAvailable = adapter.isTimelineAvailable(document, location);
    if (!timelineAvailable) {
      clearTimelineState();
      return;
    }

    const postCards = adapter.getPostCards(document);
    if (postCards.length === 0) {
      clearAllFiltering();
      return;
    }

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
          createdAtMs: adapter.readCreatedAt?.(postCard) ?? Number.NaN,
          isReply: adapter.readIsReply?.(postCard) ?? false,
          isQuote: adapter.readIsQuote?.(postCard) ?? false,
          isRepost: adapter.readIsRepost(postCard),
        },
        thresholdsFor(siteSettings),
      );

      updates.push({
        cell,
        state: result.state,
        reason: result.reason,
      });
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
    const hasMatchedPostBelowViewport = updates.some(
      (update) =>
        update.state === "matched" &&
        update.cell.getBoundingClientRect().bottom > window.innerHeight + 4,
    );
    if (
      filteringEnabled() &&
      adapter.needsLayoutProbeForPagination &&
      !adapter.hasReachedTimelineEnd?.(document) &&
      !hasMatchedPostBelowViewport
    ) {
      startLayoutProbe();
    } else {
      stopLayoutProbe();
    }
    restoreViewportAnchor(viewportAnchor);
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
    stopLayoutProbe();
    loadWarningTracker?.reset();
    clearAllFiltering();
  }

  function handleRoute(): void {
    const nextPageKey = pageKey();
    if (nextPageKey !== observedPageKey) {
      observedPageKey = nextPageKey;
      layoutProbePausedByUser = false;
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
    if (enabled) {
      layoutProbePausedByUser = false;
    } else {
      stopLayoutProbe();
    }
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
      return {
        site: adapter.settingsKey,
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
    stopLayoutProbe();
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    browser.runtime.onMessage.removeListener(handleTimelineControlMessage);
    window.removeEventListener("wheel", handleUserNavigation, true);
    window.removeEventListener("touchstart", handleUserNavigation, true);
    window.removeEventListener("pointerdown", handleUserNavigation, true);
    window.removeEventListener("keydown", handleUserNavigation, true);
    window.removeEventListener("scroll", handleScroll);
    loadWarningTracker?.dispose();
    try {
      unwatchSettings();
    } catch {
      // 拡張機能のコンテキストが既に無効になっているかもしれない。
    }
    clearTimelineState();
  }

  function handlePageHide(event: PageTransitionEvent): void {
    if (!event.persisted) {
      dispose();
    }
  }

  function handlePageShow(event: PageTransitionEvent): void {
    if (!event.persisted || disposed) {
      return;
    }
    void settingsItem
      .getValue()
      .then(handleSettingsChange)
      .catch(() => {});
    handleRoute();
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
      if (!adapter.needsLayoutProbeForPagination) {
        return;
      }

      const movesTowardStart =
        (event instanceof WheelEvent && event.deltaY < 0) ||
        (event instanceof KeyboardEvent &&
          (["ArrowUp", "Home", "PageUp"].includes(event.key) ||
            (event.key === " " && event.shiftKey)));
      const movesTowardEnd =
        (event instanceof WheelEvent && event.deltaY > 0) ||
        (event instanceof KeyboardEvent &&
          (["ArrowDown", "End", "PageDown"].includes(event.key) ||
            (event.key === " " && !event.shiftKey)));
      const layoutProbeRunning =
        layoutProbeFrame !== null ||
        layoutProbeTimer !== null ||
        document.documentElement.hasAttribute("data-sift-layout-probe");

      if (movesTowardStart && layoutProbeRunning) {
        const scrollingElement =
          document.scrollingElement ?? document.documentElement;
        const initialScrollTop =
          scrollTopBeforeLayoutProbe ?? scrollingElement.scrollTop;
        let targetScrollTop = 0;
        if (event instanceof WheelEvent) {
          const pixelsPerUnit =
            event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? 40
              : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? window.innerHeight
                : 1;
          targetScrollTop = Math.max(
            0,
            initialScrollTop + event.deltaY * pixelsPerUnit,
          );
        } else if (event instanceof KeyboardEvent && event.key !== "Home") {
          const distance =
            event.key === "ArrowUp" ? 40 : window.innerHeight * 0.9;
          targetScrollTop = Math.max(0, initialScrollTop - distance);
        }
        layoutProbePausedByUser = true;
        stopLayoutProbe(false);
        window.requestAnimationFrame(() => {
          if (!disposed) {
            window.scrollTo({ top: targetScrollTop, behavior: "instant" });
          }
        });
      } else if (
        layoutProbePausedByUser &&
        movesTowardEnd &&
        isAtPageBottom()
      ) {
        layoutProbePausedByUser = false;
        scheduleFilter();
      }
    }
  }

  function handleScroll(): void {
    if (
      filteringEnabled() &&
      adapter.needsLayoutProbeForPagination &&
      !layoutProbePausedByUser
    ) {
      scheduleFilter();
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
  window.addEventListener("pageshow", handlePageShow);
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
  window.addEventListener("scroll", handleScroll, { passive: true });

  return { dispose };
}

export default defineContentScript({
  matches: SITE_MATCHES,
  runAt: "document_idle",
  main(ctx) {
    startContentRuntime(ctx, selectAdapter(location.hostname));
  },
});
