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

// The custom element WXT hosts the shadow root on. Kebab-case is required, and
// entrypoints/content/style.css is what places it on the page — everything
// below this line is inside the shadow root and cannot reach out.
const TOOLBAR_TAG = "sift-toolbar";

// The toolbar's own styles, isolated by the shadow root. Passed to WXT rather
// than written into the markup so the two stay separable, and kept out of
// entrypoints/content/style.css because that stylesheet is injected into the
// page itself, where none of this should reach.
const TOOLBAR_CSS = `
  :host {
    color-scheme: light dark;
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
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
  // Nothing to read here. The runtime still answers dispose() so the caller
  // does not have to know whether it started.
  if (!maybeAdapter) {
    return { dispose() {} };
  }
  // Reassigned into a fresh, never-reassigned const so the functions declared
  // below keep the non-null narrowing — TS does not carry a parameter's
  // narrowing into hoisted function declarations on its own.
  const adapter = maybeAdapter;

  // Tied to the runtime's life rather than the world's: the injection that
  // replaces this script disposes the previous runtime first, so there is no
  // window in which both are subscribed.
  const stopUncaughtReporting = startUncaughtReporting({
    target: window,
    source: "content",
    // X's own exceptions reach this same window, and recording them would be
    // a false report. Only frames naming the extension's origin are Sift's.
    filterToOwnCode: true,
  });

  let settings = normalizeSettings(defaults);
  let observer: MutationObserver | null = null;
  let routeTimer: number | null = null;
  let filterFrame: number | null = null;
  let showAllTemporarily = false;
  // WXT builds the host element, the shadow root and the container inside it.
  // `toolbar` is that UI once it exists — it is built asynchronously, so the
  // first filter passes can run before there is anything to mount.
  let toolbar: ShadowRootContentScriptUi<void> | null = null;
  let toolbarMounted = false;
  let disposed = false;
  let reportedFilterPass = false;

  // Where the toolbar's own elements are, while it is on screen. Everything
  // that reads or writes them goes through here rather than holding on to a
  // container across a mount: WXT empties it on remove and fills a fresh one
  // on the next mount.
  function toolbarRoot(): ParentNode | null {
    return toolbarMounted && toolbar ? toolbar.uiContainer : null;
  }

  // Which of image and video counts as media is the reader's setting, so the
  // two arrive separately from the adapter and are folded together here.
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
        ? `注目 ${counts.hit}・上昇中 ${counts.rising}・非表示 ${counts.hidden}`
        : "フィルター停止中";
    }
    if (toggle) {
      toggle.textContent = settings.enabled ? "抽出 ON" : "抽出 OFF";
      toggle.dataset.active = String(settings.enabled);
    }
    if (reveal) {
      reveal.textContent = showAllTemporarily
        ? "抽出表示に戻す"
        : "全件を一時表示";
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
      // Posts on a live page are always HTMLElements; the adapter contract
      // only promises Element, since that is all it reads.
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
        // Which numbers those counts are compared against is the service's,
        // not this loop's: Misskey's reactions have their own pair.
        thresholdsFor(settings, adapter.thresholdKeys),
      );

      setCellState(cell, result.state, result.reason);
      counts[result.state] += 1;
    }

    updateToolbarCounts(counts);

    // Once per runtime, tell the development worker what the first pass did.
    // See utils/dev-link.ts — compiled out of a release with the guard.
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
      // Nowhere to report it from a content script, and the toolbar already
      // shows the value the reader chose. The watch below re-reads whatever
      // storage actually holds if the write did land after all.
    });
  }

  // How far one press of a threshold input's arrow moves it. Derived from
  // that threshold's own default so it stays proportional to the service's
  // scale: X counts likes in the hundreds, Misskey reactions in the tens.
  function thresholdStep(key: ThresholdKey): number {
    return Math.max(1, Math.round(defaults[key] / 10));
  }

  function toolbarMarkup(): string {
    const { minReactions, risingMinReactions } = adapter.thresholdKeys;
    return `
        <div class="panel" data-role="panel" role="dialog" aria-label="Siftの設定" hidden>
          <div class="panel-header"><strong>フィルター設定</strong><span>自動保存</span></div>
          <label>通常の最低${adapter.reactionLabel}数<input data-setting="${minReactions}" type="number" min="0" step="${thresholdStep(minReactions)}"></label>
          <label>上昇中を表示<input data-setting="risingEnabled" type="checkbox"></label>
          <label>上昇中の最低${adapter.reactionLabel}数<input data-setting="${risingMinReactions}" type="number" min="0" step="${thresholdStep(risingMinReactions)}"></label>
          <label>投稿後の時間<span class="input-with-unit"><input data-setting="risingMaxAgeHours" type="number" min="1" max="168">時間</span></label>
          <label>メディア<select data-setting="mediaMode"><option value="any">画像・動画</option><option value="images">画像のみ</option></select></label>
          <label>リポストを除外<input data-setting="hideReposts" type="checkbox"></label>
          <p class="hint">青線は通常、橙線は上昇中の投稿です。</p>
        </div>
        <div class="toolbar">
          <button data-action="toggle-enabled"></button><span class="status" data-role="status" role="status" aria-live="polite">判定中…</span><button data-action="toggle-show-all">全件を一時表示</button><button data-action="toggle-panel" aria-expanded="false">設定</button>
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

  // The whole settings value, since it is stored as one — nothing to merge
  // back into what this runtime already had.
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
      // The extension context may already be invalidated.
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
      // The extension context may already be invalidated — this runtime is
      // being replaced, or the extension was reloaded under the page. The
      // defaults it started with stay in place and nothing else runs.
    });

  // Built once, mounted and removed as the page gains and loses posts. The
  // API is async — WXT fetches the stylesheet over the network when a content
  // script hands its CSS over that way, which this one does not — so the first
  // filter passes can run before there is a toolbar to show, and ask again
  // here once there is.
  void createShadowRootUi<void>(ctx, {
    name: TOOLBAR_TAG,
    position: "inline",
    anchor: "body",
    css: TOOLBAR_CSS,
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
      // Filtering runs without it; what is lost is the way to change the
      // settings from the page itself.
    });

  const unwatchSettings = settingsItem.watch(handleSettingsChange);
  window.addEventListener("pagehide", handlePageHide);

  return { dispose };
}

export default defineContentScript({
  matches: SITE_MATCHES,
  runAt: "document_idle",
  main(ctx) {
    // A re-injection — WXT's dev mode injecting a fresh copy into a tab the
    // previous generation still holds — runs this file again in a realm that may
    // still carry the old listeners and DOM. The owner symbol is how the incoming
    // generation finds the outgoing one and takes it down first; without it the
    // two draw the same toolbar twice and both filter the same posts.
    //
    // globalThis has no index signature for an arbitrary symbol — cast once at
    // this one access point rather than widening globalThis's type project-wide.
    const runtimeSymbol = Symbol.for(CONTENT_RUNTIME_KEY);
    const runtimeGlobal = globalThis as unknown as Record<
      symbol,
      ReturnType<typeof startContentRuntime> | undefined
    >;
    runtimeGlobal[runtimeSymbol]?.dispose();
    runtimeGlobal[runtimeSymbol] = startContentRuntime(
      // Everything WXT hangs off this injection: the toolbar's shadow root is
      // built against it, so it comes down with the script that made it.
      ctx,
      // The page itself, not only its host: a host Sift was not built for is
      // one the reader added as a Misskey instance, and the page is what
      // confirms it (utils/adapters/index.ts).
      selectAdapter(location.hostname, document),
    );

    // Tell the development worker this page got the script. It is the one piece
    // of evidence for "the extension is actually on the page" that can be read
    // without a person looking at the browser, and in dev mode that question has
    // a real answer either way (#31). Compiled out of a release with the guard.
    // The path only — a log file has no business holding query strings.
    if (__SIFT_DEV__) {
      browser.runtime
        .sendMessage({
          type: DEV_CONTENT_STARTED,
          page: `${location.origin}${location.pathname}`,
        })
        .catch(() => {
          // No worker awake to hear it, and starting one is the point.
        });
    }
  },
});
