// ホストページの表示言語は読者の X / Bluesky の設定で決まり、Sift の UI 言語
// とは無関係に変わる（#82）。ここに載る綴りは、Node 24.16 / ICU 78.3 の
// `Intl.NumberFormat(locale, { notation: "compact" })` を40ロケール分実測し、
// 桁が言語をまたいで衝突しないと確認できたものだけ＝出典は Issue #82 の
// コメント（40ロケールの実測・分割の記録と確定方針）。
//
// 漢数字・ハングルの単位（千/천・万/萬/만・億/亿/억）は、同じ漢数字の体系を
// 各言語が自分の字で書いているだけなので、意味が言語で動かない。
//
// ラテン文字は2文字以上の綴りだけを載せる。1文字の `K` は元々衝突が無く、
// `B` / `M` は英語・主要言語での読み（10億・100万）に対してトルコ語の `B`
// （1,000）とインドネシア語の `M`（10億）が衝突するが、ページの言語を読まない
// 以上どちらの読みを採るか決めようがないため、英語の読みのまま据え置く＝
// この2つはここでは直らない残（#82 のコメントに明記）。
const unitMultipliers: Record<string, number> = Object.freeze({
  K: 1000,
  M: 1000000,
  B: 1000000000,
  千: 1000,
  천: 1000,
  万: 10000,
  萬: 10000,
  만: 10000,
  億: 100000000,
  亿: 100000000,
  억: 100000000,
  MIL: 1000, // es・pt: mil
  MI: 1000000, // pt: mi
  BI: 1000000000, // pt-BR: bi
  "MIO.": 1000000, // de: Mio.
  "MRD.": 1000000000, // de: Mrd.
  MN: 1000000, // tr: Mn
  MR: 1000000000, // tr: Mr
  MLN: 1000000, // it: Mln
  MLD: 1000000000, // it: Mld
  "MLN.": 1000000, // 語末が点付きで終わる言語向け: mln.
  "MLD.": 1000000000, // 同上: mld.
  "TYS.": 1000, // pl: tys.
  RB: 1000, // id: rb
  JT: 1000000, // id: jt
  TR: 1000000, // vi: Tr
  MD: 1000000000, // fr: Md
});

// `T` は単位だと分かっているのに桁が決まらない綴り＝ベトナム語では10億
// （tỷ）、デンマーク語では1,000。ページの言語を読まない以上どちらとも
// 決められないので、判定不能（`Number.NaN`）を返す対象としてここに残す。
const ambiguousUnits: ReadonlySet<string> = new Set(["T"]);

// 単位の候補になりうる綴り。ここに載っていないラテン文字の連なり（例:
// `likes` `Like` のような読み上げラベルの地の文）は単位ではなく散文として
// 無視する＝そうしないと英語圏の投稿が軒並み「単位はあるが桁が決まらない」
// 扱いになり、判定不能を隠さない方針の下でフィルタが実質止まる（#82）。
const unitPattern =
  "MIO\\.|MRD\\.|MLN\\.|MLD\\.|TYS\\.|MLN|MLD|MN|MR|MD|TR|MIL|MI|BI|RB|JT|" +
  "千|천|万|萬|만|億|亿|억|[KMBT]";

// 単位の綴りの直後にラテン文字が続くなら、それは単位ではなく綴りの途中
// （`Mio.` の `M`、`Mn` の `M`、`bi` の `b` 等）＝ `(?![A-Za-z])` の語境界を
// 2文字以上の綴りの表と同時に入れる。片方だけでは `Mio.`（de）・`Mn`（tr）・
// `Mln`（it）・`bi`（pt-BR）のような、今まで（たまたま）正しく読めていた
// 綴りが壊れる。語境界を単位の候補グループの内側（捕獲・任意の外側では
// なく）に置くのは、単位が無い入力（例: `1,234 likes`）で `\s*` の巻き戻し
// に巻き込まれて数字側まで壊さないため。
const metricPattern = new RegExp(
  `(\\d[\\d.,]*)\\s*((?:${unitPattern})(?![A-Za-z]))?`,
  "i",
);

export function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );
}

export function parseMetric(value: unknown): number {
  const normalized = normalizeDigits(value)
    .replace(/\u00a0/g, " ")
    .trim();
  const match = normalized.match(metricPattern);

  if (!match) {
    return 0;
  }

  const unit = match[2] ? match[2].toUpperCase() : "";
  // 上の正規表現でこの捕獲は必須なので、`match` があれば必ずこちらもある＝
  // 既定値は添字アクセスの型を満たすためだけのもので、実際には使われない。
  let numericText = match[1] ?? "";

  if (unit) {
    numericText = numericText.replace(",", ".");
  } else {
    numericText = numericText.replace(/[,.]/g, "");
  }

  const numericValue = Number.parseFloat(numericText);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  // 単位だと分かっているのに桁が決まらない綴り＝判定不能。0（数値が無い）
  // とは区別する必要があるため、`Number.NaN` を返す。`classifyPost` はこれを
  // 隠さない扱いにする。
  if (ambiguousUnits.has(unit)) {
    return Number.NaN;
  }

  return Math.round(numericValue * (unitMultipliers[unit] ?? 1));
}

export interface Post {
  mediaMatches: boolean;
  likeCount: number;
  createdAtMs: number;
  isRepost: boolean;
  text?: string;
}

export interface ClassifyThresholds {
  excludedKeywords: readonly string[];
  hideReposts: boolean;
  minLikes: number;
  risingEnabled: boolean;
  risingMinLikes: number;
  risingMaxAgeHours: number;
}

export type ClassifyState = "hit" | "rising" | "hidden";
export type ClassifyReason =
  | "no-media"
  | "excluded-keyword"
  | "repost"
  | "indeterminate-metric"
  | "minimum-likes"
  | "rising"
  | "below-threshold";

export interface ClassifyResult {
  state: ClassifyState;
  reason: ClassifyReason;
}

export function classifyPost(
  post: Post,
  settings: ClassifyThresholds,
  nowMs = Date.now(),
): ClassifyResult {
  if (!post.mediaMatches) {
    return { state: "hidden", reason: "no-media" };
  }

  const normalizedText = (post.text ?? "").toLowerCase();
  if (
    settings.excludedKeywords.some((keyword) =>
      normalizedText.includes(keyword),
    )
  ) {
    return { state: "hidden", reason: "excluded-keyword" };
  }

  if (settings.hideReposts && post.isRepost) {
    return { state: "hidden", reason: "repost" };
  }

  // `parseMetric` が判定不能（`Number.NaN`）を返した投稿。誤って隠すと
  // 利用者からは見えず回復できないが、誤って残すのは目に入るだけなので、
  // ここでは隠さずに残す（#82）。
  if (!Number.isFinite(post.likeCount)) {
    return { state: "hit", reason: "indeterminate-metric" };
  }

  if (post.likeCount >= settings.minLikes) {
    return { state: "hit", reason: "minimum-likes" };
  }

  if (
    settings.risingEnabled &&
    Number.isFinite(post.createdAtMs) &&
    post.likeCount >= settings.risingMinLikes
  ) {
    const ageHours = (nowMs - post.createdAtMs) / 3600000;
    if (ageHours >= -0.1 && ageHours <= settings.risingMaxAgeHours) {
      return { state: "rising", reason: "rising" };
    }
  }

  return { state: "hidden", reason: "below-threshold" };
}
