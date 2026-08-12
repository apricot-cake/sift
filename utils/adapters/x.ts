// X（x.com / twitter.com）。このファイルにあるのは全部 X の画面の作り＝どの
// 要素が投稿で、判定の入力がそれぞれどこに書かれているか。判定そのものは
// filter-core.ts にあり、全サービスで共有している。
import { parseMetric } from "../filter-core.ts";
import { LIKE_THRESHOLDS } from "../settings.ts";
import type { ServiceAdapter } from "./types.ts";

// X の画面の作りを1箇所に集めてあるので、X 側の描き直しはここ1箇所の修正で
// 済む。エクスポートしないのは、テストが与えるのはマークアップで、読み取るのは
// このファイルがそれに対して返す答えだから（utils/adapters/x.test.ts）。
const X_SELECTORS = Object.freeze({
  postCard: 'article[data-testid="tweet"]',
  postCell: '[data-testid="cellInnerDiv"]',
  reactionButton: 'button[data-testid="like"], button[data-testid="unlike"]',
  createdAt: "time[datetime]",
  image: '[data-testid="tweetPhoto"], a[href*="/photo/"]',
  video:
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], video, a[href*="/video/"]',
  postText: '[data-testid="tweetText"]',
  socialContext: '[data-testid="socialContext"]',
});

// `:` の注釈ではなく `satisfies` を使うのは、Object.freeze が保つリテラル型
// （`id` と `matches` の各要素）をリテラルのまま残すため＝注釈にすると
// インターフェース側の `string` / `readonly string[]` へ広がってしまう。
export const xAdapter = Object.freeze({
  id: "x",
  matches: Object.freeze(["https://x.com/*", "https://twitter.com/*"]),
  thresholdKeys: LIKE_THRESHOLDS,

  getPostCards(root: ParentNode) {
    return Array.from(root.querySelectorAll(X_SELECTORS.postCard));
  },

  hasPostCards(root: ParentNode) {
    return Boolean(root.querySelector(X_SELECTORS.postCard));
  },

  // 隠される単位。X は投稿を、区切り線と周囲の余白も持つセルで包んでいるので、
  // カードだけを隠すと隙間が残る。
  findPostCell(postCard: Element) {
    return postCard.closest(X_SELECTORS.postCell) || postCard;
  },

  readReactionCount(postCard: Element) {
    const button = postCard.querySelector(X_SELECTORS.reactionButton);
    if (!button) {
      return 0;
    }

    const accessibleText = button.getAttribute("aria-label") || "";
    const visibleText = (button.textContent ?? "").trim();
    return parseMetric(accessibleText || visibleText);
  },

  readCreatedAt(postCard: Element) {
    const dateTime = postCard
      .querySelector(X_SELECTORS.createdAt)
      ?.getAttribute("datetime");
    const timestamp = dateTime ? Date.parse(dateTime) : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  },

  // 画像と動画は別々に返す＝どちらをメディアと数えるかは利用者の設定であって、
  // このサービスの作りの話ではない。
  readMedia(postCard: Element) {
    return {
      hasImage: Boolean(postCard.querySelector(X_SELECTORS.image)),
      hasVideo: Boolean(postCard.querySelector(X_SELECTORS.video)),
    };
  },

  readText(postCard: Element) {
    return Array.from(postCard.querySelectorAll(X_SELECTORS.postText))
      .filter((text) => text.closest(X_SELECTORS.postCard) === postCard)
      .map((text) => text.textContent ?? "")
      .join(" ");
  },

  readIsRepost(postCard: Element) {
    // 表示文言は読者の言語で変わる。リポストの socialContext だけは、リポスト
    // した人のプロフィールへの相対リンクに入る。固定ポストの socialContext は
    // リンク外なので、文言ではなくこの構造で区別する。
    return Array.from(
      postCard.querySelectorAll(X_SELECTORS.socialContext),
    ).some(
      (socialContext) =>
        socialContext.closest(X_SELECTORS.postCard) === postCard &&
        Boolean(socialContext.closest('a[href^="/"]')),
    );
  },
}) satisfies ServiceAdapter;
