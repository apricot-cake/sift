import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import type { FilterContextResponse } from "../../utils/filter-context.ts";
import { checkPanelBuild } from "../../utils/local-build-reload.ts";
import {
  isLoadMoreResponse,
  type LoadMoreResponse,
  PANEL_CANCEL_LOAD,
  PANEL_LOAD_MORE,
} from "../../utils/panel-load-more.ts";
import { sidePanelTabIdFromUrl } from "../../utils/sidepanel-controls.ts";

export function usePostLoadMore(
  context: FilterContextResponse | null,
  refresh: () => Promise<void>,
) {
  const [loading, setLoading] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const [result, setResult] = useState<LoadMoreResponse | null>(null);
  const latest = useRef({ context, refresh });
  latest.current = { context, refresh };
  const active = useRef<symbol | null>(null);
  const settling = useRef<symbol | null>(null);
  const mounted = useRef(false);
  const owner = useRef(sidePanelTabIdFromUrl(location.href));
  const pageKey = context?.pageKey;
  const knownTimeline = useRef<{
    page: string | undefined;
    timeline: string | null;
  }>({ page: pageKey, timeline: context?.timelineKey ?? null });
  if (knownTimeline.current.page !== pageKey)
    knownTimeline.current = {
      page: pageKey,
      timeline: context?.timelineKey ?? null,
    };
  else if (context?.timelineKey != null)
    knownTimeline.current.timeline = context.timelineKey;
  const sourceKey = JSON.stringify([pageKey, knownTimeline.current.timeline]);

  const cancel = useCallback(() => {
    if (active.current === null) return;
    active.current = null;
    if (owner.current !== null)
      void browser.tabs
        .sendMessage(owner.current, { type: PANEL_CANCEL_LOAD })
        .catch(() => {});
    if (mounted.current) {
      setResult({ status: "cancelled", added: 0 });
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 一覧が変わったら旧一覧の読み込みを中止し、状態を初期化する。
  useEffect(() => {
    mounted.current = true;
    setLoading(settling.current !== null);
    setResult(null);
    setRequestCount(0);
    const visibility = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    const activated = ({ tabId }: { tabId: number }) => {
      if (tabId !== owner.current) cancel();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", cancel);
    browser.tabs.onActivated.addListener(activated);
    return () => {
      mounted.current = false;
      cancel();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", cancel);
      browser.tabs.onActivated.removeListener(activated);
    };
  }, [sourceKey, cancel]);

  const loadMore = useCallback(async () => {
    const source = latest.current.context;
    const tabId = owner.current;
    if (
      active.current !== null ||
      settling.current !== null ||
      tabId === null ||
      source == null ||
      !source.timelineAvailable ||
      source.collectionTruncated ||
      document.visibilityState === "hidden"
    )
      return;
    const request = Symbol();
    active.current = request;
    settling.current = request;
    setLoading(true);
    setResult(null);
    const isCurrent = () =>
      mounted.current &&
      active.current === request &&
      latest.current.context?.pageKey === source.pageKey &&
      (source.timelineKey == null ||
        latest.current.context?.timelineKey == null ||
        source.timelineKey === latest.current.context.timelineKey) &&
      document.visibilityState !== "hidden";
    try {
      if (!(await checkPanelBuild()) || !isCurrent()) return;
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id !== tabId || !isCurrent()) return;
      setRequestCount((count) => count + 1);
      const response: unknown = await browser.tabs.sendMessage(tabId, {
        type: PANEL_LOAD_MORE,
        pageKey: source.pageKey,
        timelineKey: source.timelineKey ?? null,
      });
      if (!isCurrent()) return;
      setResult(
        isLoadMoreResponse(response)
          ? response
          : { status: "failed", added: 0 },
      );
      await latest.current.refresh();
    } catch {
      if (isCurrent()) setResult({ status: "failed", added: 0 });
    } finally {
      if (active.current === request) {
        active.current = null;
      }
      if (settling.current === request) {
        settling.current = null;
        if (mounted.current) setLoading(false);
      }
    }
  }, []);

  return { loading, result, loadMore, cancel, requestCount };
}
