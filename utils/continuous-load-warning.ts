import type { ClassifyState } from "./filter-core.ts";

export interface ContinuousLoadObservation {
  readonly id: string;
  readonly state: ClassifyState;
}

interface ContinuousLoadWarningOptions {
  readonly settleMs?: number;
  readonly maxBatchMs?: number;
  readonly maxGapMs?: number;
  readonly requiredHiddenBatches?: number;
  readonly maxTrackedIds?: number;
}

export class ContinuousLoadWarningTracker {
  readonly #settleMs: number;
  readonly #maxBatchMs: number;
  readonly #maxGapMs: number;
  readonly #requiredHiddenBatches: number;
  readonly #maxTrackedIds: number;
  #knownIds = new Set<string>();
  #pending = new Map<string, ClassifyState>();
  #settleTimer: number | null = null;
  #batchTimer: number | null = null;
  #expiryTimer: number | null = null;
  #hiddenBatchCount = 0;
  #lastHiddenBatchAt: number | null = null;
  #warning = false;
  #capacityExceeded = false;

  constructor(options: ContinuousLoadWarningOptions = {}) {
    this.#settleMs = options.settleMs ?? 800;
    this.#maxBatchMs = options.maxBatchMs ?? 2_000;
    this.#maxGapMs = options.maxGapMs ?? 5_000;
    this.#requiredHiddenBatches = options.requiredHiddenBatches ?? 3;
    this.#maxTrackedIds = options.maxTrackedIds ?? 10_000;
    if (
      !Number.isSafeInteger(this.#maxTrackedIds) ||
      this.#maxTrackedIds < 1 ||
      this.#maxTrackedIds > 10_000
    ) {
      throw new RangeError("maxTrackedIds must be between 1 and 10000");
    }
  }

  get warning(): boolean {
    return this.#warning;
  }

  reset(currentIds: Iterable<string> = []): void {
    this.#clearTimers();
    this.#knownIds.clear();
    this.#pending.clear();
    this.#clearChain();
    this.#capacityExceeded = false;
    for (const id of currentIds) {
      if (this.#knownIds.has(id)) continue;
      if (this.#knownIds.size === this.#maxTrackedIds) {
        this.#exceedCapacity();
        break;
      }
      this.#knownIds.add(id);
    }
  }

  observe(observations: readonly ContinuousLoadObservation[]): void {
    if (this.#capacityExceeded) return;
    let added = false;
    for (const observation of observations) {
      if (this.#knownIds.has(observation.id)) {
        continue;
      }
      if (this.#pending.get(observation.id) === observation.state) {
        continue;
      }
      if (
        !this.#pending.has(observation.id) &&
        this.#knownIds.size + this.#pending.size === this.#maxTrackedIds
      ) {
        this.#exceedCapacity();
        return;
      }
      this.#pending.set(observation.id, observation.state);
      added = true;
    }
    if (!added) {
      return;
    }
    if (this.#batchTimer === null) {
      this.#batchTimer = window.setTimeout(
        () => this.#finalizeBatch(),
        this.#maxBatchMs,
      );
    }
    if (this.#settleTimer !== null) {
      window.clearTimeout(this.#settleTimer);
    }
    this.#settleTimer = window.setTimeout(
      () => this.#finalizeBatch(),
      this.#settleMs,
    );
  }

  dispose(): void {
    this.reset();
  }

  #finalizeBatch(): void {
    if (this.#settleTimer !== null) {
      window.clearTimeout(this.#settleTimer);
      this.#settleTimer = null;
    }
    if (this.#batchTimer !== null) {
      window.clearTimeout(this.#batchTimer);
      this.#batchTimer = null;
    }
    if (this.#pending.size === 0) {
      return;
    }
    const allHidden = Array.from(this.#pending.values()).every(
      (state) => state === "hidden",
    );
    for (const id of this.#pending.keys()) {
      this.#knownIds.add(id);
    }
    this.#pending.clear();
    if (!allHidden) {
      this.#clearChain();
      return;
    }

    const now = Date.now();
    this.#hiddenBatchCount =
      this.#lastHiddenBatchAt !== null &&
      now - this.#lastHiddenBatchAt <= this.#maxGapMs
        ? this.#hiddenBatchCount + 1
        : 1;
    this.#lastHiddenBatchAt = now;
    this.#warning = this.#hiddenBatchCount >= this.#requiredHiddenBatches;

    if (this.#expiryTimer !== null) {
      window.clearTimeout(this.#expiryTimer);
    }
    this.#expiryTimer = window.setTimeout(
      () => this.#clearChain(),
      this.#maxGapMs,
    );
  }

  #clearChain(): void {
    if (this.#expiryTimer !== null) {
      window.clearTimeout(this.#expiryTimer);
      this.#expiryTimer = null;
    }
    this.#hiddenBatchCount = 0;
    this.#lastHiddenBatchAt = null;
    this.#warning = false;
  }

  #clearTimers(): void {
    if (this.#settleTimer !== null) {
      window.clearTimeout(this.#settleTimer);
      this.#settleTimer = null;
    }
    if (this.#batchTimer !== null) {
      window.clearTimeout(this.#batchTimer);
      this.#batchTimer = null;
    }
    if (this.#expiryTimer !== null) {
      window.clearTimeout(this.#expiryTimer);
      this.#expiryTimer = null;
    }
  }

  #exceedCapacity(): void {
    // IDを捨てて追跡を続けると再描画を新規取得と誤認する。上限を超えた一覧では
    // 警告だけを停止し、次のresetまで投稿のフィルターは通常どおり続ける。
    this.#capacityExceeded = true;
    this.#clearTimers();
    this.#knownIds.clear();
    this.#pending.clear();
    this.#clearChain();
  }
}
