import { describe, expect, it } from "vitest";
import {
  isPageHealth,
  type PageHealthObservation,
  PageHealthTracker,
} from "./page-health.ts";

const good: PageHealthObservation = {
  pageKey: "/home",
  support: "supported",
  empty: false,
  sampledPosts: 3,
  readableMetrics: 3,
};
describe("ページ情報の健全性", () => {
  it("不要な情報の欠損は内部診断だけに残す", () => {
    const tracker = new PageHealthTracker(100);
    const partial = { ...good, readableMetrics: 1 };
    tracker.observe(partial, 0);
    expect(tracker.observe(partial, 1000)).toMatchObject({
      state: "degraded",
      warnPartial: false,
    });
  });
  it("必要情報の欠損が続いた場合だけ警告し、解除・復旧・遷移で猶予をリセットする", () => {
    const tracker = new PageHealthTracker(100);
    const partial = { ...good, readableMetrics: 1, requiresMetrics: true };
    expect(tracker.observe(partial, 0).warnPartial).toBe(false);
    expect(tracker.observe(partial, 99).warnPartial).toBe(false);
    expect(tracker.observe(partial, 100).warnPartial).toBe(true);
    expect(
      tracker.observe({ ...partial, requiresMetrics: false }, 101).warnPartial,
    ).toBe(false);
    expect(tracker.observe(partial, 102).warnPartial).toBe(false);
    tracker.observe(good, 200);
    expect(tracker.observe(partial, 201).warnPartial).toBe(false);
    expect(
      tracker.observe({ ...partial, pageKey: "/other" }, 500).warnPartial,
    ).toBe(false);
  });
  it("構造不明は対象外とせず、読み込み猶予後に失敗を報告する", () => {
    const tracker = new PageHealthTracker(100);
    expect(tracker.observe({ ...good, support: "unknown" }, 0).state).toBe(
      "loading",
    );
    expect(tracker.observe({ ...good, support: "unknown" }, 100).state).toBe(
      "unreadable",
    );
    expect(tracker.observe(good, 101).state).toBe("ready");
    expect(tracker.observe({ ...good, support: "unknown" }, 102).state).toBe(
      "loading",
    );
  });
  it("カードがないだけでは空一覧と断定しない", () => {
    const tracker = new PageHealthTracker(0);
    const none = { ...good, sampledPosts: 0, readableMetrics: 0 };
    expect(tracker.observe(none).state).toBe("unreadable");
    expect(tracker.observe({ ...none, empty: true }).state).toBe("empty");
    expect(
      tracker.observe({ ...none, empty: true, support: "unknown" }).state,
    ).toBe("unreadable");
  });
  it("反応数の全件欠損と部分欠損を区別する", () => {
    const tracker = new PageHealthTracker(0);
    expect(tracker.observe(good).state).toBe("ready");
    expect(tracker.observe({ ...good, readableMetrics: 1 })).toMatchObject({
      state: "degraded",
      issue: "metrics",
    });
    expect(tracker.observe({ ...good, readableMetrics: 0 })).toMatchObject({
      state: "unreadable",
      issue: "metrics",
    });
  });
  it("ページ遷移後は新たな猶予を与え、明示的な対象外は即時確定する", () => {
    const tracker = new PageHealthTracker(100);
    const broken = { ...good, support: "unknown" as const };
    tracker.observe(broken, 0);
    expect(
      tracker.observe({ ...broken, pageKey: "/profile/other" }, 200).state,
    ).toBe("loading");
    expect(
      tracker.observe({ ...good, support: "unsupported" }, 201).state,
    ).toBe("unsupported");
  });
  it("不正な診断データを受け付けない", () => {
    expect(
      isPageHealth({
        state: "ready",
        sampledPosts: 0,
        readableMetrics: 1,
      }),
    ).toBe(false);
    expect(isPageHealth(new PageHealthTracker().observe(good))).toBe(true);
  });
});
