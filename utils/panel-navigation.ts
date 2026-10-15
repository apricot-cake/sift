import type { FilterContextResponse } from "./filter-context.ts";

export interface PanelPage {
  id: string;
  url: string | null;
  context?: Pick<
    FilterContextResponse,
    "pageKey" | "timelineKey" | "sortOrder" | "timelineAvailable"
  >;
  pendingMedia?: { url: string; since: number };
}

export const panelPageKey = (tabId: number) => `sift:sidepanel-page:${tabId}`;

export function panelPageUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    if (
      url.hostname === "www.nicovideo.jp" &&
      url.pathname.startsWith("/search/")
    ) {
      for (const key of ["rd", "rf", "rp"]) url.searchParams.delete(key);
      url.searchParams.sort();
    }
    return url.href;
  } catch {
    return null;
  }
}

/** URLだけでは画像の詳細ページと一覧上のライトボックスを区別できない。 */
export function isXMediaNavigation(value: string | null): boolean {
  if (!value) return false;
  const url = new URL(value);
  return (
    ["x.com", "twitter.com"].includes(url.hostname) &&
    /^\/(?:[\w]{1,15}|i\/web)\/status\/\d+\/(?:photo|video)\/\d+\/?$/.test(
      url.pathname,
    )
  );
}

export function panelPageContext(
  context: FilterContextResponse,
): PanelPage["context"] {
  return {
    pageKey: context.pageKey,
    timelineKey: context.timelineKey ?? null,
    sortOrder: context.sortOrder,
    timelineAvailable: context.timelineAvailable,
  };
}

/** 不確定な一覧キーで既知の一覧を上書きしない。画像表示中は背景pageKeyを使う。 */
export function hasLeftPanelPage(
  page: PanelPage,
  current: FilterContextResponse,
): boolean {
  const previous = page.context;
  if (!previous) return false;
  if (panelPageUrl(previous.pageKey) !== panelPageUrl(current.pageKey))
    return true;
  if (
    previous.timelineKey &&
    current.timelineKey &&
    previous.timelineKey !== current.timelineKey
  )
    return true;
  if (
    previous.sortOrder &&
    current.sortOrder &&
    previous.sortOrder !== "unknown" &&
    current.sortOrder !== "unknown" &&
    previous.sortOrder !== current.sortOrder
  )
    return true;
  return (
    previous.timelineAvailable &&
    !current.timelineAvailable &&
    current.health?.state === "unsupported"
  );
}
