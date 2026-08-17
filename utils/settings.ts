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
  // 抽出の有効・無効はサイト単位。既定値は新しく見るホストにも使い、hosts は
  // 利用者がその既定を変えたホストだけを持つ。以前の全体スイッチが OFF だった
  // 設定は defaultEnabled: false に移行するので、追加済み・後から追加するサイトを
  // どちらも意図に反して有効化しない。
  siteEnabled: Object.freeze({
    defaultEnabled: true as boolean,
    hosts: Object.freeze({}) as Readonly<Record<string, boolean>>,
  }),
  minLikes: 500 as number,
  risingEnabled: true as boolean,
  risingMinLikes: 100 as number,
  risingMaxAgeHours: 6 as number,
  mediaMode: "all" as "all" | "any" | "images" | "video",
  excludedKeywords: "" as string,
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

// 入力は1行に1語または1句。空行を捨て、同じ語を何度も判定しないようにする。
// 照合は大小文字を区別しないので、重複判定も同じ基準で行う。
export function normalizeExcludedKeywords(value: unknown): string {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const keyword = line.trim();
    const normalized = keyword.toLowerCase();
    if (keyword !== "" && !seen.has(normalized)) {
      seen.add(normalized);
      keywords.push(keyword);
    }
  }
  return keywords.join("\n");
}

export function excludedKeywordsFrom(value: string): readonly string[] {
  return normalizeExcludedKeywords(value)
    .split("\n")
    .filter(Boolean)
    .map((keyword) => keyword.toLowerCase());
}

function normalizeSiteEnabled(
  value: unknown,
  legacyEnabled: boolean,
): Settings["siteEnabled"] {
  const source = value && typeof value === "object" ? value : {};
  const rawHosts =
    "hosts" in source && source.hosts && typeof source.hosts === "object"
      ? source.hosts
      : {};
  const hosts: Record<string, boolean> = {};

  for (const [entry, enabled] of Object.entries(rawHosts)) {
    const host = normalizeInstanceHost(entry);
    if (host !== null && typeof enabled === "boolean") {
      hosts[host] = enabled;
    }
  }

  return {
    defaultEnabled:
      "defaultEnabled" in source && source.defaultEnabled === false
        ? false
        : legacyEnabled,
    hosts,
  };
}

export function normalizeSettings(value: unknown): Settings {
  const source: Partial<Record<keyof Settings, unknown>> =
    value && typeof value === "object" ? value : {};
  // `enabled` は 0.3.0 までの全サイト共通スイッチ。新しい形を持たない既存の
  // 設定だけがここを通るので、旧版で OFF にしていた人のすべてのサイトを OFF の
  // まま引き継げる。新規設定には siteEnabled の既定値だけが残る。
  const migratedDefaultEnabled = !(
    !Object.hasOwn(source, "siteEnabled") &&
    (value as { enabled?: unknown } | null)?.enabled === false
  );

  return {
    siteEnabled: normalizeSiteEnabled(
      source.siteEnabled,
      migratedDefaultEnabled,
    ),
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
    mediaMode:
      source.mediaMode === "any" ||
      source.mediaMode === "images" ||
      source.mediaMode === "video"
        ? source.mediaMode
        : "all",
    excludedKeywords: normalizeExcludedKeywords(source.excludedKeywords),
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

export function isSiteEnabled(settings: Settings, hostname: string): boolean {
  const host = normalizeInstanceHost(hostname);
  if (host === null) {
    return settings.siteEnabled.defaultEnabled;
  }
  return (
    settings.siteEnabled.hosts[host] ?? settings.siteEnabled.defaultEnabled
  );
}

export function withSiteEnabled(
  settings: Settings,
  hostname: string,
  enabled: boolean,
): Settings {
  const host = normalizeInstanceHost(hostname);
  if (host === null) {
    return settings;
  }

  return normalizeSettings({
    ...settings,
    siteEnabled: {
      defaultEnabled: settings.siteEnabled.defaultEnabled,
      hosts: { ...settings.siteEnabled.hosts, [host]: enabled },
    },
  });
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
    excludedKeywords: excludedKeywordsFrom(settings.excludedKeywords),
    hideReposts: settings.hideReposts,
    minLikes: settings[keys.minReactions],
    risingEnabled: settings.risingEnabled,
    risingMinLikes: settings[keys.risingMinReactions],
    risingMaxAgeHours: settings.risingMaxAgeHours,
  };
}
