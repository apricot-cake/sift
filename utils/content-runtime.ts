import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { ServiceAdapter } from "./adapters/types.ts";
import {
  type FilterContextResponse,
  isFilterContextRequest,
} from "./filter-context.ts";
import { classifyPost } from "./filter-core.ts";
import { PageHealthTracker } from "./page-health.ts";
import {
  type CollectedPost,
  type PanelPost,
  POST_COLLECTION_LIMIT,
} from "./panel-post.ts";
import { normalizeSettings, settingsFor, thresholdsFor } from "./settings.ts";
import { settingsItem } from "./settings-storage.ts";

/** パネルからの問い合わせ時だけ一覧を読み取り、ページのDOMやスクロールは変更しない。 */
export function startContentRuntime(
  _ctx: ContentScriptContext | undefined,
  adapter: ServiceAdapter | null,
) {
  if (!adapter) return { dispose() {} };
  const service = adapter;
  const collected = new Map<string, CollectedPost>();
  const healthTracker = new PageHealthTracker();
  let sourcePage: string | null = null;
  let sourceTimeline: string | null = null;
  let truncated = false;
  let disposed = false;
  function clearCollection(): void {
    collected.clear();
    truncated = false;
  }
  async function readContext(
    reset: boolean,
  ): Promise<FilterContextResponse | undefined> {
    // 再開の初期化は受信順に行い、古い問い合わせの遅延で新しい蓄積を消さない。
    if (reset) clearCollection();
    // 設定変更の直後にも同じ条件で返す。監視やタイマーを常駐させず、
    // パネルが閉じている間は設定・投稿の読み取りも停止する。
    const settings = settingsFor(
      normalizeSettings(await settingsItem.getValue()),
      service.settingsKey,
    );
    if (disposed) return;
    const pageKey = `${location.origin}${service.readPageKey?.(document, location) ?? `${location.pathname}${location.search}`}`;
    const timelineKey = service.readTimelineKey?.(document, location) ?? null;
    const available = service.isTimelineAvailable(document, location);
    const support =
      service.readPageSupport?.(document, location) ??
      (available ? "supported" : "unsupported");
    if (
      pageKey !== sourcePage ||
      (timelineKey !== null &&
        sourceTimeline !== null &&
        timelineKey !== sourceTimeline) ||
      support === "unsupported"
    )
      clearCollection();
    if (pageKey !== sourcePage) sourceTimeline = null;
    sourcePage = pageKey;
    // 画像モーダル内で一覧キーを確定できなくても、背景一覧の蓄積は保つ。
    if (timelineKey !== null || support === "unsupported")
      sourceTimeline = timelineKey;
    const sample = available
      ? service.getMetricPostCards(document)
      : { cards: [], truncated: false };
    let readablePosts = 0;
    let readableMetrics = 0;
    for (const card of sample.cards) {
      const post = service.readPost(card);
      const metric = post ? post.metricCount : service.readMetricCount?.(card);
      if (Number.isSafeInteger(metric) && (metric ?? -1) >= 0)
        readableMetrics += 1;
      if (!post) continue;
      readablePosts += 1;
      // 仮想リストから消えた投稿も残し、再描画された同じ投稿は更新する。
      if (!collected.has(post.id) && collected.size >= POST_COLLECTION_LIMIT) {
        truncated = true;
        continue;
      }
      collected.set(post.id, post);
    }
    truncated ||= sample.truncated;
    const thresholds = thresholdsFor(settings);
    const withoutMinimum = { ...thresholds, inclusion: { minimum: null } };
    const posts: PanelPost[] = [];
    const metricCounts: number[] = [];
    let metricSampleCount = 0;
    if (available) {
      for (const post of collected.values()) {
        const mediaMatches =
          !settings.mediaEnabled ||
          (settings.mediaMode === "images"
            ? post.hasImage
            : settings.mediaMode === "video"
              ? post.hasVideo
              : post.hasImage || post.hasVideo);
        const input = {
          ...post,
          mediaMatches,
          metricCount: post.metricCount ?? Number.NaN,
        };
        if (classifyPost(input, withoutMinimum).state !== "hidden") {
          metricSampleCount += 1;
          if (post.metricCount !== null) metricCounts.push(post.metricCount);
        }
        if (classifyPost(input, thresholds).state !== "hidden") {
          // 判定用の属性をメッセージに混ぜず、描画用の情報だけを渡す。
          const { id, url, author, handle, text, images, metricCount } = post;
          posts.push({ id, url, author, handle, text, images, metricCount });
        }
      }
    }
    return {
      health: healthTracker.observe({
        pageKey: `${pageKey}:${timelineKey ?? sourceTimeline ?? ""}`,
        support,
        empty: service.hasEmptyTimeline?.(document) ?? false,
        requiresMetrics: thresholds.inclusion.minimum !== null,
        sampledPosts: sample.cards.length,
        readablePosts,
        readableMetrics,
      }),
      site: service.settingsKey,
      pageTitle: document.title,
      pageKey,
      timelineKey,
      timelineAvailable: available,
      posts,
      collectedCount: available ? collected.size : 0,
      collectionTruncated: available && truncated,
      metricCounts,
      metricSampleCount,
      metricContextTruncated: available && truncated,
    };
  }
  // 対象メッセージだけPromiseを返し、他の受信者の応答を奪わない。
  function onMessage(message: unknown) {
    if (disposed || !isFilterContextRequest(message)) return;
    return readContext(message.reset === true);
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    collected.clear();
    window.removeEventListener("pagehide", onPageHide);
    try {
      browser.runtime.onMessage.removeListener(onMessage);
    } catch {
      // 拡張更新でコンテキストが破棄された場合もローカルの情報は解放する。
    }
  }
  function onPageHide(event: PageTransitionEvent): void {
    if (!event.persisted) dispose();
  }
  browser.runtime.onMessage.addListener(onMessage);
  window.addEventListener("pagehide", onPageHide);
  return { dispose };
}
