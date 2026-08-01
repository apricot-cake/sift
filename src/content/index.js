import { classifyPost, parseMetric } from "../filter-core.js";
import { defaults, normalizeSettings } from "../settings.js";
import { CONTENT_RUNTIME_KEY } from "./runtime-key.js";

export function startContentRuntime() {
    const toolbarHostId = "xif-toolbar-host";
    const listPathPattern = /^\/i\/lists\/\d+/;

    let settings = normalizeSettings(defaults);
    let observer = null;
    let routeTimer = null;
    let filterFrame = null;
    let showAllTemporarily = false;
    let shadowRoot = null;
    let disposed = false;

    function isListPage() {
      return listPathPattern.test(window.location.pathname);
    }

    function findTimelineCell(article) {
      return article.closest('[data-testid="cellInnerDiv"]') || article;
    }

    function readLikeCount(article) {
      const button = article.querySelector(
        'button[data-testid="like"], button[data-testid="unlike"]'
      );
      if (!button) {
        return 0;
      }

      const accessibleText = button.getAttribute("aria-label") || "";
      const visibleText = button.textContent.trim();
      return parseMetric(accessibleText || visibleText);
    }

    function readCreatedAt(article) {
      const dateTime = article.querySelector("time[datetime]")?.getAttribute("datetime");
      const timestamp = dateTime ? Date.parse(dateTime) : Number.NaN;
      return Number.isFinite(timestamp) ? timestamp : Number.NaN;
    }

    function readMedia(article) {
      const hasImage = Boolean(
        article.querySelector('[data-testid="tweetPhoto"], a[href*="/photo/"]')
      );
      const hasVideo = Boolean(
        article.querySelector(
          '[data-testid="videoPlayer"], [data-testid="videoComponent"], video, a[href*="/video/"]'
        )
      );

      return {
        hasImage,
        hasVideo,
        hasMedia: settings.mediaMode === "images" ? hasImage : hasImage || hasVideo
      };
    }

    function readIsRepost(article) {
      const socialContext = article.querySelector('[data-testid="socialContext"]');
      if (!socialContext) {
        return false;
      }

      return /repost|retweeted|リポスト/i.test(socialContext.textContent);
    }

    function setCellState(cell, state, reason) {
      cell.dataset.xifFilterState = state;
      cell.dataset.xifFilterReason = reason;
    }

    function clearCellState(cell) {
      delete cell.dataset.xifFilterState;
      delete cell.dataset.xifFilterReason;
    }

    function updateToolbarCounts(counts) {
      if (!shadowRoot) {
        return;
      }

      const status = shadowRoot.querySelector('[data-role="status"]');
      const toggle = shadowRoot.querySelector('[data-action="toggle-enabled"]');
      const reveal = shadowRoot.querySelector('[data-action="toggle-show-all"]');

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
        reveal.textContent = showAllTemporarily ? "抽出表示に戻す" : "全件を一時表示";
      }
    }

    function filterVisiblePosts() {
      filterFrame = null;
      if (disposed || !isListPage()) {
        return;
      }

      document.body.classList.toggle("xif-show-all", showAllTemporarily);

      const articles = Array.from(
        document.querySelectorAll('article[data-testid="tweet"]')
      );
      const counts = { hit: 0, rising: 0, hidden: 0 };

      for (const article of articles) {
        const cell = findTimelineCell(article);

        if (!settings.enabled) {
          clearCellState(cell);
          continue;
        }

        const media = readMedia(article);
        const result = classifyPost(
          {
            hasMedia: media.hasMedia,
            likeCount: readLikeCount(article),
            createdAtMs: readCreatedAt(article),
            isRepost: readIsRepost(article)
          },
          settings
        );

        setCellState(cell, result.state, result.reason);
        counts[result.state] += 1;
      }

      updateToolbarCounts(counts);
    }

    function scheduleFilter() {
      if (disposed || filterFrame !== null) {
        return;
      }
      filterFrame = window.requestAnimationFrame(filterVisiblePosts);
    }

    function clearAllFiltering() {
      document.body.classList.remove("xif-show-all");
      for (const cell of document.querySelectorAll("[data-xif-filter-state]")) {
        clearCellState(cell);
      }
    }

    function saveSettings(partialSettings) {
      const nextSettings = normalizeSettings({ ...settings, ...partialSettings });
      chrome.storage.sync.set(nextSettings);
    }

    function toolbarMarkup() {
      return `
        <style>
          :host { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          .toolbar { align-items: center; backdrop-filter: blur(14px); background: rgba(20, 22, 25, 0.94); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32); color: #f2f2f2; display: flex; gap: 8px; padding: 9px; }
          button { background: #2f3336; border: 0; border-radius: 999px; color: inherit; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; padding: 7px 10px; white-space: nowrap; }
          button:hover { background: #3d4246; }
          button[data-active="true"] { background: #1d9bf0; color: white; }
          .status { font-size: 12px; font-variant-numeric: tabular-nums; padding: 0 3px; white-space: nowrap; }
          .panel { background: rgba(20, 22, 25, 0.98); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 16px; bottom: 54px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32); display: grid; gap: 10px; min-width: 260px; padding: 14px; position: absolute; right: 0; }
          .panel[hidden] { display: none; }
          label { align-items: center; display: flex; font-size: 13px; gap: 8px; justify-content: space-between; }
          input[type="number"], select { background: #000; border: 1px solid #536471; border-radius: 8px; box-sizing: border-box; color: white; font: inherit; padding: 6px 8px; width: 90px; }
          .hint { color: #8b98a5; font-size: 11px; line-height: 1.4; margin: 0; }
        </style>
        <div class="panel" data-role="panel" hidden>
          <label>通常の最低いいね<input data-setting="minLikes" type="number" min="0" step="50"></label>
          <label>上昇中を表示<input data-setting="risingEnabled" type="checkbox"></label>
          <label>上昇中の最低いいね<input data-setting="risingMinLikes" type="number" min="0" step="10"></label>
          <label>投稿後の時間<input data-setting="risingMaxAgeHours" type="number" min="1" max="168"></label>
          <label>メディア<select data-setting="mediaMode"><option value="any">画像・動画</option><option value="images">画像のみ</option></select></label>
          <label>リポストを除外<input data-setting="hideReposts" type="checkbox"></label>
          <p class="hint">設定は自動保存されます。青線が通常、橙線が上昇中です。</p>
        </div>
        <div class="toolbar">
          <button data-action="toggle-enabled"></button><span class="status" data-role="status">判定中…</span><button data-action="toggle-show-all">全件を一時表示</button><button data-action="toggle-panel">調整</button>
        </div>
      `;
    }

    function syncToolbarForm() {
      if (!shadowRoot) {
        return;
      }

      for (const element of shadowRoot.querySelectorAll("[data-setting]")) {
        const key = element.dataset.setting;
        if (element.type === "checkbox") {
          element.checked = Boolean(settings[key]);
        } else {
          element.value = String(settings[key]);
        }
      }
    }

    function mountToolbar() {
      if (disposed || !isListPage() || document.getElementById(toolbarHostId)) {
        return;
      }

      const host = document.createElement("div");
      host.id = toolbarHostId;
      shadowRoot = host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = toolbarMarkup();
      document.body.append(host);
      syncToolbarForm();

      shadowRoot.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) {
          return;
        }

        if (button.dataset.action === "toggle-enabled") {
          saveSettings({ enabled: !settings.enabled });
        } else if (button.dataset.action === "toggle-show-all") {
          showAllTemporarily = !showAllTemporarily;
          scheduleFilter();
        } else if (button.dataset.action === "toggle-panel") {
          const panel = shadowRoot.querySelector('[data-role="panel"]');
          panel.hidden = !panel.hidden;
        }
      });

      shadowRoot.addEventListener("change", (event) => {
        const element = event.target.closest("[data-setting]");
        if (!element) {
          return;
        }

        const value = element.type === "checkbox" ? element.checked : element.value;
        saveSettings({ [element.dataset.setting]: value });
      });
    }

    function unmountToolbar() {
      document.getElementById(toolbarHostId)?.remove();
      shadowRoot = null;
      showAllTemporarily = false;
      clearAllFiltering();
    }

    function mountReloadNotice() {
      if (!isListPage()) {
        return;
      }

      const host = document.createElement("div");
      host.id = toolbarHostId;
      shadowRoot = host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = `
        <style>
          :host { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          .notice { background: rgba(20, 22, 25, 0.96); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.32); color: #f2f2f2; display: grid; gap: 4px; max-width: 260px; padding: 12px 14px; }
          strong { font-size: 13px; }
          span { color: #aab8c2; font-size: 12px; line-height: 1.45; }
        </style>
        <div class="notice"><strong>Siftを更新しました</strong><span>このページを再読み込みすると、新しい版で復帰します。</span></div>
      `;
      document.body.append(host);
    }

    function handleRoute() {
      if (isListPage()) {
        mountToolbar();
        scheduleFilter();
      } else if (document.getElementById(toolbarHostId)) {
        unmountToolbar();
      }
    }

    function handleStorageChange(changes, areaName) {
      if (disposed || areaName !== "sync") {
        return;
      }

      const changedValues = {};
      for (const [key, change] of Object.entries(changes)) {
        changedValues[key] = change.newValue;
      }
      settings = normalizeSettings({ ...settings, ...changedValues });
      syncToolbarForm();
      scheduleFilter();
    }

    function dispose({ showReloadNotice = false } = {}) {
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
      try {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      } catch {
        // The extension context may already be invalidated.
      }
      unmountToolbar();

      if (showReloadNotice) {
        mountReloadNotice();
      }
    }

    function handlePageHide() {
      dispose();
    }

    chrome.storage.sync.get(defaults, (storedSettings) => {
      if (disposed) {
        return;
      }

      settings = normalizeSettings(storedSettings);
      mountToolbar();
      scheduleFilter();

      observer = new MutationObserver(scheduleFilter);
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });

      routeTimer = window.setInterval(handleRoute, 750);
    });

    chrome.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener("pagehide", handlePageHide);

    return { dispose };
}

const runtimeSymbol = Symbol.for(CONTENT_RUNTIME_KEY);
globalThis[runtimeSymbol]?.dispose();

const runtime = startContentRuntime();
globalThis[runtimeSymbol] = runtime;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    runtime.dispose();
    if (globalThis[runtimeSymbol] === runtime) {
      delete globalThis[runtimeSymbol];
    }
  });
}
