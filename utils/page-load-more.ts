import type { ServiceAdapter } from "./adapters/types.ts";
import type { LoadMoreResponse, LoadMoreStatus } from "./panel-load-more.ts";
import { POST_COLLECTION_LIMIT } from "./panel-post.ts";

const POLL_MS = 200;
export const PAGE_LOAD_TIMEOUT_MS = 6000;
const TARGET_ADDED_POSTS = 20;
const NO_PROGRESS_MS = 2000;
const RESTORE_TIMEOUT_MS = 1400;
const RESTORE_STABLE_SAMPLES = 3;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function visible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

/** 通常の投稿本文ではなく、サイト自身の警告・認証画面だけを判定する。 */
export function pageLoadBlockReason(
  doc: Document,
  site: "x" | "bluesky" = "x",
): "limited" | "authentication" | null {
  const pathname = doc.location?.pathname ?? "";
  if (
    /^\/(?:login|i\/flow\/(?:login|signup|challenge)|account\/access)(?:\/|$)/.test(
      pathname,
    )
  )
    return "authentication";
  if (
    site === "bluesky" &&
    /^\/(?:login|signup|verify-email|account\/access)(?:\/|$)/.test(pathname)
  )
    return "authentication";
  for (const node of doc.querySelectorAll(
    site === "x"
      ? '[role="alert"], [data-testid="toast"], [data-testid="primaryColumn"] [data-testid="emptyState"], [role="dialog"]'
      : '[role="alert"], [role="dialog"], [data-testid="errorMessage"], [data-testid="errorScreen"], [data-testid="loginScreen"], [data-testid="sessionExpired"]',
  )) {
    if (!visible(node)) continue;
    const text = node.textContent ?? "";
    if (
      /rate limit|rate-limit|too many requests|利用制限|アクセスが集中|リクエストが多すぎ|表示回数の制限|しばらくしてからもう一度/i.test(
        text,
      )
    )
      return "limited";
    if (
      (node.matches(
        '[role="dialog"], [data-testid="loginScreen"], [data-testid="sessionExpired"]',
      ) ||
        (site === "bluesky" &&
          node.matches(
            '[role="alert"], [data-testid="errorMessage"], [data-testid="errorScreen"]',
          ))) &&
      /(?:log in|sign in|ログイン|本人確認|認証してください|session expired|セッション.*(?:切れ|期限)|sign in again)/i.test(
        text,
      )
    )
      return "authentication";
  }
  return null;
}

/** React Native Webなど、文書内の独立したスクロール領域も扱う。 */
export function postScrollElement(card: Element): HTMLElement | null {
  let parent = card.parentElement;
  while (
    parent &&
    parent !== document.body &&
    parent !== document.documentElement
  ) {
    if (
      /^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) &&
      parent.clientHeight > 0 &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent;
    parent = parent.parentElement;
  }
  return null;
}

interface PageLoadOptions {
  readonly adapter: ServiceAdapter;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  /** DOMが仮想化で消える前に、同期的に収集する。 */
  readonly collect: () => number;
}

/** 明示操作ごとに次のまとまりを時間内で収集し、通常の閲覧位置へ戻す。 */
export class PageLoadMore {
  private furthest = 0;
  private scrollElement: HTMLElement | null = null;

  reset(): void {
    this.furthest = 0;
    this.scrollElement = null;
  }

  async run({
    adapter,
    signal,
    isCurrent,
    collect,
  }: PageLoadOptions): Promise<LoadMoreResponse> {
    const view = document.defaultView;
    const cancelled = () =>
      signal.aborted || !isCurrent() || document.visibilityState === "hidden";
    if (!view || cancelled()) return { status: "cancelled", added: 0 };
    const block = pageLoadBlockReason(document, adapter.settingsKey);
    if (block) return { status: block, added: 0 };
    const before = collect();
    if (before >= POST_COLLECTION_LIMIT) return { status: "limit", added: 0 };
    const cards = adapter.getPostCards(document);
    if (!cards.length) return { status: "unsupported", added: 0 };
    const element = postScrollElement(cards[0] as Element);
    if (element !== this.scrollElement) this.furthest = 0;
    this.scrollElement = element;
    const getY = () => element?.scrollTop ?? view.scrollY;
    const getX = () => element?.scrollLeft ?? view.scrollX;
    const originalY = getY();
    const originalX = getX();
    const viewportTop = element
      ? Math.max(0, element.getBoundingClientRect().top)
      : 0;
    const viewportBottom = element
      ? Math.min(view.innerHeight, element.getBoundingClientRect().bottom)
      : view.innerHeight;
    const viewportHeight = viewportBottom - viewportTop;
    if (viewportHeight <= 0) return { status: "unsupported", added: 0 };
    const scrollTo = (top: number) => {
      const options = { left: originalX, top, behavior: "instant" as const };
      if (element) element.scrollTo(options);
      else view.scrollTo(options);
    };
    const scrollBy = (top: number) => {
      if (element) element.scrollBy({ top, behavior: "instant" });
      else view.scrollBy({ top, behavior: "instant" });
    };
    const anchors = cards.flatMap((card) => {
      const cell = adapter.findPostCell(card);
      const rect = cell.getBoundingClientRect();
      const id = adapter.readPostId?.(card);
      return id &&
        rect.height > 0 &&
        rect.bottom > viewportTop &&
        rect.top < viewportBottom
        ? [{ id, top: rect.top }]
        : [];
    });
    // プロフィール先頭ではヘッダーだけが見えていて投稿は下にある場合がある。
    // 先頭座標は投稿IDなしでも確定できる。途中の位置で基準投稿がなければ動かさない。
    if (!anchors.length && originalY > 2)
      return { status: "unsupported", added: 0 };
    const lastBottom = Math.max(
      ...cards.map(
        (card) =>
          adapter.findPostCell(card).getBoundingClientRect().bottom -
          viewportTop +
          originalY,
      ),
    );
    const target =
      Math.max(originalY, this.furthest, lastBottom - viewportHeight) +
      viewportHeight * 0.8;
    // 元ページで操作が始まった後は、古い座標への復元を行わない。
    const interaction = new AbortController();
    const userActed = (event: Event) => {
      if (event.isTrusted) interaction.abort();
    };
    const eventTypes = [
      "wheel",
      "touchstart",
      "pointerdown",
      "keydown",
    ] as const;
    for (const type of eventTypes)
      view.addEventListener(type, userActed, { capture: true, passive: true });
    const stop = () => cancelled() || interaction.signal.aborted;
    let status: LoadMoreStatus = "no-progress";
    let total = before;
    try {
      scrollTo(target);
      // 下端でスクロールが制限されたとき、未到達の目標値を蓄積しない。
      this.furthest = getY();
      const deadline = Date.now() + PAGE_LOAD_TIMEOUT_MS;
      const goal = Math.min(before + TARGET_ADDED_POSTS, POST_COLLECTION_LIMIT);
      const contentHeight = () =>
        (element ?? document.scrollingElement ?? document.documentElement)
          .scrollHeight;
      let heightAtStep = contentHeight();
      let canAdvance = getY() > originalY + 1;
      let nextStepAt = Date.now() + POLL_MS;
      let lastProgressAt = Date.now();
      while (Date.now() < deadline && !stop()) {
        const reason = pageLoadBlockReason(document, adapter.settingsKey);
        if (reason) {
          status = reason;
          break;
        }
        const current = collect();
        if (current > total) lastProgressAt = Date.now();
        total = current;
        if (total >= goal) {
          status = "loaded";
          break;
        }
        if (total > before && Date.now() - lastProgressAt >= NO_PROGRESS_MS)
          break;
        if (
          Date.now() >= nextStepAt &&
          (canAdvance ||
            getY() + 1 < this.furthest ||
            contentHeight() > heightAtStep + 1)
        ) {
          const previousY = getY();
          scrollTo(Math.max(previousY, this.furthest) + viewportHeight * 0.8);
          canAdvance = getY() > previousY + 1;
          heightAtStep = contentHeight();
          this.furthest = Math.max(this.furthest, getY());
          nextStepAt = Date.now() + POLL_MS;
        }
        // 終端では同じスクロールを繰り返さず、サイトの遅延描画を待つ。
        await wait(POLL_MS, signal);
      }
      if (!isCurrent() || interaction.signal.aborted)
        return { status: "cancelled", added: Math.max(0, total - before) };
      if (signal.aborted) status = "cancelled";
      total = collect();
      this.furthest = Math.max(this.furthest, getY());
      if (total > before && status === "no-progress") status = "loaded";
      // まず元の座標へ戻し、仮想リストが再描画した投稿IDで位置を補正する。
      scrollTo(originalY);
      const restoreDeadline = Date.now() + RESTORE_TIMEOUT_MS;
      let stableSamples = 0;
      const checkRestored = (correct: boolean): boolean => {
        if (!anchors.length) {
          const restored = originalY <= 2 && Math.abs(getY() - originalY) <= 2;
          if (!restored && correct) scrollTo(originalY);
          return restored;
        }
        const visibleCards = adapter.getPostCards(document);
        const anchor = anchors.find((saved) =>
          visibleCards.some((card) => adapter.readPostId?.(card) === saved.id),
        );
        const card =
          anchor &&
          visibleCards.find((item) => adapter.readPostId?.(item) === anchor.id);
        if (!anchor || !card) return false;
        const rect = adapter.findPostCell(card).getBoundingClientRect();
        if (rect.height <= 0) return false;
        const offset = rect.top - anchor.top;
        const restored = Math.abs(offset) <= 2;
        if (!restored && correct) scrollBy(offset);
        return restored;
      };
      while (
        Date.now() < restoreDeadline &&
        isCurrent() &&
        !interaction.signal.aborted
      ) {
        stableSamples = checkRestored(true) ? stableSamples + 1 : 0;
        if (stableSamples >= RESTORE_STABLE_SAMPLES) break;
        await wait(POLL_MS, interaction.signal);
      }
      if (stop())
        return { status: "cancelled", added: Math.max(0, total - before) };
      // 待機の最終フレームで基準投稿が消えた場合も、以前の成功を流用しない。
      const restored =
        stableSamples >= RESTORE_STABLE_SAMPLES && checkRestored(false);
      return {
        status:
          !restored && (status === "loaded" || status === "no-progress")
            ? "restore-failed"
            : status,
        added: Math.max(0, total - before),
      };
    } catch {
      // DOMの差し替えや抽出の例外でも、同じ一覧で利用者の操作がなければ戻す。
      // 例外時にさらに読み進めたり、自動で再試行したりしない。
      if (isCurrent() && !interaction.signal.aborted) {
        try {
          scrollTo(originalY);
        } catch {
          return {
            status: "restore-failed",
            added: Math.max(0, total - before),
          };
        }
      }
      return { status: "failed", added: Math.max(0, total - before) };
    } finally {
      for (const type of eventTypes)
        view.removeEventListener(type, userActed, true);
    }
  }
}
