import type { ServiceAdapter } from "./adapters/types.ts";

/** パネル開閉による幅変更の間だけ、実際に見えていた投稿の位置を保つ。 */
export class PanelViewport {
  private readonly route = `${location.pathname}${location.search}`;
  private readonly timeline: string | null;
  private readonly anchors: { id: string; top: number }[] = [];
  private frame: number | null = null;
  private until = 0;
  private readonly adapter: ServiceAdapter;

  constructor(adapter: ServiceAdapter) {
    this.adapter = adapter;
    this.timeline = adapter.readTimelineKey?.(document, location) ?? null;
  }

  capture(): void {
    this.anchors.length = 0;
    for (const card of this.adapter.getPostCards(document)) {
      const cell = this.adapter.findPostCell(card);
      const rect = cell.getBoundingClientRect();
      const id = this.adapter.readPostId?.(card);
      if (
        !id ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight
      )
        continue;
      const left = Math.max(0, rect.left);
      const right = Math.min(window.innerWidth, rect.right);
      if (right <= left) continue;
      const hit = document.elementFromPoint(
        (left + right) / 2,
        (Math.max(0, rect.top) + Math.min(window.innerHeight, rect.bottom)) / 2,
      );
      if (hit && cell.contains(hit)) this.anchors.push({ id, top: rect.top });
    }
  }

  resize(): void {
    if (!this.anchors.length) return;
    this.until = performance.now() + 2000;
    this.restore();
  }

  private restore(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const timeline =
        this.adapter.readTimelineKey?.(document, location) ?? null;
      if (
        performance.now() >= this.until ||
        `${location.pathname}${location.search}` !== this.route ||
        (timeline !== null && timeline !== this.timeline)
      ) {
        this.cancel();
        return;
      }
      // タブや投稿がレスポンシブ表示で差し替えられている間は描画を待つ。
      if (this.timeline === null || timeline !== null) {
        const cards = this.adapter.getPostCards(document);
        for (const anchor of this.anchors) {
          const card = cards.find(
            (item) => this.adapter.readPostId?.(item) === anchor.id,
          );
          if (!card) continue;
          const rect = this.adapter.findPostCell(card).getBoundingClientRect();
          if (rect.height <= 0) continue;
          const offset = rect.top - anchor.top;
          if (Math.abs(offset) > 1)
            window.scrollBy({ top: offset, behavior: "instant" });
          break;
        }
      }
      this.restore();
    });
  }

  cancel(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.until = 0;
  }
}
