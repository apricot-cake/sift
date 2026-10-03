import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContinuousLoadWarningTracker } from "./continuous-load-warning.ts";

function hidden(id: string) {
  return { id, state: "hidden" as const };
}

function matched(id: string) {
  return { id, state: "matched" as const };
}

function visible(id: string) {
  return { id, state: "visible" as const };
}

describe("連続読み込みの警告", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("全件不一致の追加取得が3回続いた時だけ警告する", () => {
    const tracker = new ContinuousLoadWarningTracker();

    tracker.observe([hidden("1")]);
    vi.advanceTimersByTime(800);
    tracker.observe([hidden("2")]);
    vi.advanceTimersByTime(800);
    expect(tracker.warning).toBe(false);
    tracker.observe([hidden("3")]);
    vi.advanceTimersByTime(800);

    expect(tracker.warning).toBe(true);
  });

  it("読み込み済みの投稿と同じIDの再描画は数えない", () => {
    const tracker = new ContinuousLoadWarningTracker();
    tracker.reset(["1"]);

    for (let index = 0; index < 4; index += 1) {
      tracker.observe([hidden("1")]);
      vi.advanceTimersByTime(800);
    }

    expect(tracker.warning).toBe(false);
  });

  it("途中に表示対象があれば連鎖をリセットする", () => {
    const tracker = new ContinuousLoadWarningTracker();

    tracker.observe([hidden("1")]);
    vi.advanceTimersByTime(800);
    tracker.observe([hidden("2")]);
    vi.advanceTimersByTime(800);
    tracker.observe([matched("3")]);
    vi.advanceTimersByTime(800);
    tracker.observe([hidden("4")]);
    vi.advanceTimersByTime(800);

    expect(tracker.warning).toBe(false);
  });

  it("描画途中の投稿は追加取得が落ち着いた時点の状態で判定する", () => {
    const tracker = new ContinuousLoadWarningTracker();

    for (const id of ["1", "2", "3"]) {
      tracker.observe([visible(id)]);
      tracker.observe([hidden(id)]);
      vi.advanceTimersByTime(800);
    }

    expect(tracker.warning).toBe(true);
  });

  it("追加取得が落ち着く前に表示対象になった投稿を不一致と数えない", () => {
    const tracker = new ContinuousLoadWarningTracker();

    tracker.observe([hidden("1")]);
    vi.advanceTimersByTime(800);
    tracker.observe([hidden("2")]);
    vi.advanceTimersByTime(800);
    tracker.observe([hidden("3")]);
    tracker.observe([matched("3")]);
    vi.advanceTimersByTime(800);

    expect(tracker.warning).toBe(false);
  });

  it("投稿追加が途切れなくても一定時間ごとに一群を確定する", () => {
    const tracker = new ContinuousLoadWarningTracker();

    for (let index = 0; index < 12; index += 1) {
      tracker.observe([hidden(String(index))]);
      vi.advanceTimersByTime(500);
    }

    expect(tracker.warning).toBe(true);
  });

  it("ユーザー操作としてresetされると連鎖を引き継がない", () => {
    const tracker = new ContinuousLoadWarningTracker();

    tracker.observe([hidden("1")]);
    vi.advanceTimersByTime(800);
    tracker.observe([hidden("2")]);
    vi.advanceTimersByTime(800);
    tracker.reset(["1", "2"]);
    tracker.observe([hidden("3")]);
    vi.advanceTimersByTime(800);

    expect(tracker.warning).toBe(false);
  });

  it("追加取得が途切れたら警告を消す", () => {
    const tracker = new ContinuousLoadWarningTracker();

    for (const id of ["1", "2", "3"]) {
      tracker.observe([hidden(id)]);
      vi.advanceTimersByTime(800);
    }
    expect(tracker.warning).toBe(true);

    vi.advanceTimersByTime(5_000);

    expect(tracker.warning).toBe(false);
  });

  it("上限超過後は同じ一覧を新規取得として数えない", () => {
    const tracker = new ContinuousLoadWarningTracker({ maxTrackedIds: 2 });
    tracker.reset(["1", "2", "3"]);
    for (let i = 0; i < 4; i++) {
      tracker.observe([hidden("1"), hidden("2"), hidden("3")]);
      vi.advanceTimersByTime(800);
    }
    expect(tracker.warning).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("上限を超える一群の表示投稿を捨てて誤警告しない", () => {
    const tracker = new ContinuousLoadWarningTracker({ maxTrackedIds: 2 });
    tracker.observe([hidden("1")]);
    vi.advanceTimersByTime(800);
    tracker.observe([hidden("2")]);
    vi.advanceTimersByTime(800);
    tracker.observe([matched("visible"), hidden("3"), hidden("4")]);
    vi.advanceTimersByTime(800);
    expect(tracker.warning).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("IDの初期化も上限で読み取りを止める", () => {
    const tracker = new ContinuousLoadWarningTracker({ maxTrackedIds: 2 });
    let reads = 0;
    function* ids() {
      for (let i = 0; i < 100; i++) {
        reads++;
        yield String(i);
      }
    }
    tracker.reset(ids());
    expect(reads).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("上限超過の警告停止はreset後に解除する", () => {
    const tracker = new ContinuousLoadWarningTracker({ maxTrackedIds: 3 });
    tracker.reset(["1", "2", "3", "4"]);
    tracker.reset();
    for (const id of ["5", "6", "7"]) {
      tracker.observe([hidden(id)]);
      vi.advanceTimersByTime(800);
    }
    expect(tracker.warning).toBe(true);
  });
  it("設定の上限を無限大や不正値で無効化できない", () => {
    for (const maxTrackedIds of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      10001,
    ]) {
      expect(() => new ContinuousLoadWarningTracker({ maxTrackedIds })).toThrow(
        RangeError,
      );
    }
  });
});
