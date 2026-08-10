import { describe, expect, it } from "vitest";
import {
  defaults,
  isSiteEnabled,
  LIKE_THRESHOLDS,
  MISSKEY_REACTION_THRESHOLDS,
  normalizeSettings,
  thresholdsFor,
  withSiteEnabled,
} from "./settings.ts";

describe("normalizeSettings", () => {
  // 書き込み時だけでなく読み出しのたびに検査し直す＝保管庫には、この拡張機能の
  // 古い版が置いたものも入りうる。
  it("しきい値を自分の範囲へ収める", () => {
    expect(
      normalizeSettings({ misskeyMinReactions: "35" }).misskeyMinReactions,
    ).toBe(35);
    expect(
      normalizeSettings({ misskeyMinReactions: -4 }).misskeyMinReactions,
    ).toBe(0);
  });

  it("そもそも数でない値には既定値を使う", () => {
    expect(
      normalizeSettings({ misskeyRisingMinReactions: "not a number" })
        .misskeyRisingMinReactions,
    ).toBe(defaults.misskeyRisingMinReactions);
  });

  // utils/instances.ts が当てるのと同じ正規化＝正しくないものと重複は落とし、
  // 無い値や配列でない値は例外ではなく空の一覧になる。
  it("インスタンスの一覧から、正しくないホストと重複を落とす", () => {
    expect(
      normalizeSettings({
        misskeyInstances: ["misskey.io", "misskey.io", "http://bad", "x.com"],
      }).misskeyInstances,
    ).toEqual(["misskey.io", "x.com"]);
  });

  it("読めないものには空のインスタンス一覧を返す", () => {
    expect(normalizeSettings({}).misskeyInstances).toEqual([]);
    expect(
      normalizeSettings({ misskeyInstances: "not-an-array" }).misskeyInstances,
    ).toEqual([]);
    expect(defaults.misskeyInstances).toEqual([]);
  });

  it("旧版の全体OFFをサイトごとの既定OFFへ移行する", () => {
    const settings = normalizeSettings({ enabled: false });

    expect(isSiteEnabled(settings, "x.com")).toBe(false);
    expect(isSiteEnabled(settings, "misskey.example")).toBe(false);
  });

  it("ホストごとに抽出の有効・無効を分ける", () => {
    const settings = withSiteEnabled(normalizeSettings({}), "x.com", false);

    expect(isSiteEnabled(settings, "x.com")).toBe(false);
    expect(isSiteEnabled(settings, "bsky.app")).toBe(true);
  });
});

// 判定が取るのは2つ1組の数で、どちらの組かはサービスによる。判定が取る他の
// ものは全サービスで共通。
describe("thresholdsFor", () => {
  const stored = normalizeSettings({
    minLikes: 500,
    risingMinLikes: 100,
    misskeyMinReactions: 20,
    misskeyRisingMinReactions: 5,
    risingMaxAgeHours: 6,
    hideReposts: true,
  });

  it("いいねのしきい値から判定を埋める", () => {
    expect(thresholdsFor(stored, LIKE_THRESHOLDS)).toEqual({
      hideReposts: true,
      minLikes: 500,
      risingEnabled: true,
      risingMinLikes: 100,
      risingMaxAgeHours: 6,
    });
  });

  it("Misskey 自身の組から埋め、残りは共通のままにする", () => {
    expect(thresholdsFor(stored, MISSKEY_REACTION_THRESHOLDS)).toEqual({
      hideReposts: true,
      minLikes: 20,
      risingEnabled: true,
      risingMinLikes: 5,
      risingMaxAgeHours: 6,
    });
  });
});
