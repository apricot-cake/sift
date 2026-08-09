// 設定とは何で、正しい設定とはどういうものか。どこに置くかは
// utils/settings-storage.ts＝分けてあるのは、このファイルをビルドスクリプトが
// 読めるようにしておくため。ビルドスクリプトは node で動き、拡張機能の API を
// 一切持たない（scripts/verify-manifest.ts がアダプター経由でここへ届く）。
import type { ClassifyThresholds } from "./filter-core.ts";
import { normalizeInstanceHost } from "./instances.ts";

// どの値もリテラルより広い型を明示している（推論に任せて `true` にせず
// `as boolean` と書く）＝Object.freeze() の型引数は各プロパティを最も狭い
// リテラル型に推論してしまい、normalizeSettings() がそこへ戻れなくなる
// （計算した `boolean` は `true` ではありえない）。
export const defaults = Object.freeze({
  enabled: true as boolean,
  minLikes: 500 as number,
  risingEnabled: true as boolean,
  risingMinLikes: 100 as number,
  risingMaxAgeHours: 6 as number,
  mediaMode: "any" as "any" | "images",
  hideReposts: true as boolean,
  misskeyInstances: Object.freeze([]) as readonly string[],
  // Misskey が数えるのはいいねではなくリアクションで、インスタンスの規模は X
  // とは桁で違う＝両サービスに1つのしきい値を当てると、どちらかが永久に空か
  // 永久に素通しになる（#2 の Issue コメント第4節）。この2つの数は、2日より
  // 古いメディア付きノートで実際に観測したリアクション数から取ったもの＝20 は
  // その上位およそ 7〜15% を残し、上昇中の窓での 5 は X の 500 に対する 100 と
  // 同じ広さの網になる（2026-08-05 に misskey.io と misskey.design で計測）。
  misskeyMinReactions: 20 as number,
  misskeyRisingMinReactions: 5 as number,
});

// 2度目の宣言をせず `defaults` から導いてあるので、両者がずれることがない＝
// `defaults` にフィールドを足せば、この型は黙ってそれを得る。
export type Settings = typeof defaults;

function clampInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

// 書き込み時だけでなく読み出しのたびに検査し直す＝保管庫には、この拡張機能の
// 古い版が置いたものも、権限が設定と足並みを揃えずに取り消された後で
// chrome://extensions が残したものも入りうる。
function normalizeInstanceList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const hosts: string[] = [];
  for (const entry of value) {
    const host = normalizeInstanceHost(entry);
    if (host !== null && !seen.has(host)) {
      seen.add(host);
      hosts.push(host);
    }
  }
  return hosts;
}

export function normalizeSettings(value: unknown): Settings {
  const source: Partial<Record<keyof Settings, unknown>> =
    value && typeof value === "object" ? value : {};

  return {
    enabled: source.enabled !== false,
    minLikes: clampInteger(source.minLikes, defaults.minLikes, 0, 1000000000),
    risingEnabled: source.risingEnabled !== false,
    risingMinLikes: clampInteger(
      source.risingMinLikes,
      defaults.risingMinLikes,
      0,
      1000000000,
    ),
    risingMaxAgeHours: clampInteger(
      source.risingMaxAgeHours,
      defaults.risingMaxAgeHours,
      1,
      168,
    ),
    mediaMode: source.mediaMode === "images" ? "images" : "any",
    hideReposts: source.hideReposts !== false,
    misskeyInstances: normalizeInstanceList(source.misskeyInstances),
    misskeyMinReactions: clampInteger(
      source.misskeyMinReactions,
      defaults.misskeyMinReactions,
      0,
      1000000000,
    ),
    misskeyRisingMinReactions: clampInteger(
      source.misskeyRisingMinReactions,
      defaults.misskeyRisingMinReactions,
      0,
      1000000000,
    ),
  };
}

// あるサービスの反応数を、保管してある2つの数のどちらの組と比べるか。組に
// 名前を付けるのはアダプター（utils/adapters/types.ts）で、設定の画面は入力を
// 同じキーに結びつける＝だからツールバーは、自分がどのサービスの上にいるかを
// 知らないまま Misskey のページで Misskey のしきい値を編集できる。
export interface ThresholdKeys {
  readonly minReactions: "minLikes" | "misskeyMinReactions";
  readonly risingMinReactions: "risingMinLikes" | "misskeyRisingMinReactions";
}

// その4つの設定のどれか1つ＝組のどちらであるかを気にせずしきい値を扱う
// コードのためのもの。
export type ThresholdKey = ThresholdKeys[keyof ThresholdKeys];

// X と Bluesky はこれを共有する＝いいねはどちらでも同じ意味だから。
export const LIKE_THRESHOLDS: ThresholdKeys = Object.freeze({
  minReactions: "minLikes",
  risingMinReactions: "risingMinLikes",
});

export const MISSKEY_REACTION_THRESHOLDS: ThresholdKeys = Object.freeze({
  minReactions: "misskeyMinReactions",
  risingMinReactions: "misskeyRisingMinReactions",
});

// classifyPost() が取るしきい値を、そのサービス自身の組から埋めたもの。判定に
// 関わる他のもの＝上昇中の窓・メディアの扱い・リポストを落とすかどうかは、
// どのサービスでも共通の1つの設定。
export function thresholdsFor(
  settings: Settings,
  keys: ThresholdKeys,
): ClassifyThresholds {
  return {
    hideReposts: settings.hideReposts,
    minLikes: settings[keys.minReactions],
    risingEnabled: settings.risingEnabled,
    risingMinLikes: settings[keys.risingMinReactions],
    risingMaxAgeHours: settings.risingMaxAgeHours,
  };
}
