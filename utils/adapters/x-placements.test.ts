import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { startContentRuntime } from "../content-runtime.ts";
import {
  FILTER_CONTEXT_REQUEST,
  type FilterContextResponse,
} from "../filter-context.ts";
import { defaults } from "../settings.ts";
import { settingsItem } from "../settings-storage.ts";
import { xAdapter } from "./x.ts";

const fixture = readFileSync(
  path.join(process.cwd(), "test/fixtures/adapters/x-placement-cards.html"),
  "utf8",
);
let runtime: ReturnType<typeof startContentRuntime> | undefined;

beforeEach(async () => {
  fakeBrowser.reset();
  history.replaceState({}, "", "/home");
  document.body.innerHTML = fixture;
  await settingsItem.setValue({
    ...defaults,
    siteSettings: {
      ...defaults.siteSettings,
      x: {
        ...defaults.siteSettings.x,
        mediaEnabled: false,
        minReactionsEnabled: false,
        hideReposts: false,
      },
    },
  });
});
afterEach(() => {
  runtime?.dispose();
  runtime = undefined;
  vi.restoreAllMocks();
});
async function context(): Promise<FilterContextResponse> {
  const [value] = await fakeBrowser.runtime.onMessage.trigger(
    { type: FILTER_CONTEXT_REQUEST },
    {},
    () => {},
  );
  return value as unknown as FilterContextResponse;
}

describe("Xの投稿リンクを持たない広告枠", () => {
  it("時刻リンクのない広告だけを、投稿収集と診断の両方から除く", () => {
    const cards = xAdapter.getPostCards(document);
    expect(
      cards.map((card) =>
        card.closest("[data-fixture]")?.getAttribute("data-fixture"),
      ),
    ).toEqual(["normal-video", "broken-post", "linked-placement"]);
    expect(xAdapter.getMetricPostCards(document).cards).toEqual(cards);
    expect(xAdapter.hasPostCards(document)).toBe(true);
    const ad = document.querySelector('[data-fixture="unlinked-ad"]');
    if (!ad) throw new Error("広告枠がありません");
    expect(xAdapter.getPostCards(ad)).toEqual([]);
    expect(xAdapter.getMetricPostCards(ad).cards).toEqual([]);
    expect(xAdapter.hasPostCards(ad)).toBe(false);
  });
  it("通常動画の子孫にあるplacementTrackingは広告枠の根拠にしない", () => {
    const root = document.querySelector('[data-fixture="normal-video"]');
    if (!root) throw new Error("動画投稿がありません");
    expect(xAdapter.hasPostCards(root)).toBe(true);
    const card = xAdapter.getMetricPostCards(root).cards[0];
    if (!card) throw new Error("動画投稿が取得されません");
    expect(xAdapter.readPost(card)).toMatchObject({
      id: "101",
      hasVideo: true,
    });
  });
  it("投稿permalinkを持つ広告枠は一律に除外しない", () => {
    const root = document.querySelector('[data-fixture="linked-placement"]');
    if (!root) throw new Error("投稿枠がありません");
    expect(xAdapter.getPostCards(root)).toHaveLength(1);
    expect(xAdapter.getMetricPostCards(root).cards).toHaveLength(1);
  });
  it("広告以外の読み取り可能な投稿だけなら診断は正常になる", async () => {
    document.querySelector('[data-fixture="broken-post"]')?.remove();
    runtime = startContentRuntime(undefined, xAdapter);
    expect(await context()).toMatchObject({
      collectedCount: 2,
      health: { state: "ready", sampledPosts: 2, readableMetrics: 2 },
    });
  });
  it("広告枠ではない一般投稿のリンク欠損は引き続き診断で検出する", async () => {
    runtime = startContentRuntime(undefined, xAdapter);
    const partial = await context();
    expect(partial.health).toMatchObject({
      state: "degraded",
      issue: "posts",
      sampledPosts: 3,
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    document.querySelector('[data-fixture="normal-video"]')?.remove();
    document.querySelector('[data-fixture="linked-placement"]')?.remove();
    expect((await context()).health).toMatchObject({
      state: "loading",
      issue: "posts",
      sampledPosts: 1,
    });
    clock.mockReturnValue(10000);
    expect((await context()).health).toMatchObject({
      state: "unreadable",
      issue: "posts",
      sampledPosts: 1,
    });
  });
});
