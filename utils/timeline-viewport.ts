import type { ServiceAdapter } from "./adapters/types.ts";

interface Anchor {
  id: string;
  top: number;
}

// レスポンシブ表示で DOM が置き換わっても追跡できるように投稿 ID を保存する。
// スクロール座標だけでは、幅変更や再描画後の投稿の高さに追従できない。
export class TimelineViewport {
  private key: string | null = null;
  private away = false;
  private anchors: Anchor[] = [];
  private width = window.innerWidth;
  private restoringUntil = 0;
  private frame: number | null = null;

  private readonly adapter: ServiceAdapter;

  constructor(adapter: ServiceAdapter) {
    this.adapter = adapter;
  }

  private currentKey(): string | null {
    return this.adapter.readTimelineKey?.(document, location) ?? null;
  }

  syncRoute(): boolean {
    const key = this.currentKey();
    if (key === null) {
      this.away = true;
      this.cancel();
      return false;
    }
    if (key !== this.key) {
      this.cancel();
      this.anchors = [];
      this.key = key;
    } else if (this.away) {
      this.beginRestore();
    }
    this.away = false;
    return true;
  }

  private remember(): void {
    const anchors: Anchor[] = [];
    for (const card of this.adapter.getPostCards(document)) {
      const cell = this.adapter.findPostCell(card) as HTMLElement;
      if (cell.dataset.siftFilterState === "hidden") continue;
      const { top, bottom, height } = cell.getBoundingClientRect();
      const id = this.adapter.readPostId?.(card);
      if (id && height > 0 && bottom > 0 && top < window.innerHeight) {
        anchors.push({ id, top });
      }
    }
    // 再描画中の空の一覧で直前の位置を消さない。
    if (anchors.length > 0) this.anchors = anchors;
    this.width = window.innerWidth;
  }

  isRestoring(): boolean {
    return this.restoringUntil > 0;
  }

  private beginRestore(): void {
    if (this.anchors.length === 0) return;
    // 画像や仮想リストの測定が遅れても追従する。ユーザー操作で直ちに終了する。
    this.restoringUntil = performance.now() + 2_000;
    this.queueRestore();
  }

  private queueRestore(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      if (performance.now() >= this.restoringUntil) {
        this.restoringUntil = 0;
        if (this.currentKey() === this.key) this.remember();
        return;
      }
      if (this.currentKey() !== this.key) {
        this.queueRestore();
        return;
      }
      const cards = this.adapter.getPostCards(document);
      for (const anchor of this.anchors) {
        const card = cards.find(
          (item) => this.adapter.readPostId?.(item) === anchor.id,
        );
        if (!card) continue;
        const cell = this.adapter.findPostCell(card) as HTMLElement;
        // フィルター適用前の位置へ移動すると X が別の範囲を描画してしまう。
        if (
          !cell.dataset.siftFilterState ||
          cell.dataset.siftFilterState === "hidden"
        )
          continue;
        const rect = cell.getBoundingClientRect();
        if (rect.height === 0) continue;
        const offset = rect.top - anchor.top;
        if (Math.abs(offset) > 1)
          window.scrollBy({ top: offset, behavior: "instant" });
        break;
      }
      this.queueRestore();
    });
  }

  update(): void {
    if (!this.syncRoute()) return;
    if (this.width !== window.innerWidth) this.resize();
    if (this.restoringUntil === 0) this.remember();
  }

  resize(): void {
    this.width = window.innerWidth;
    if (this.syncRoute()) this.beginRestore();
  }

  cancel(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.restoringUntil = 0;
  }

  reset(): void {
    this.cancel();
    this.key = null;
    this.anchors = [];
    this.away = false;
    this.width = window.innerWidth;
  }
}
