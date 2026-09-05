// Bluesky（bsky.app）。このファイルにあるのは全部 Bluesky の画面の作り＝どの
// 要素が投稿で、判定の入力がそれぞれどこに書かれているか。判定そのものは
// filter-core.ts にあり、全サービスで共有している。
import { parseMetric } from "../filter-core.ts";
import type { ServiceAdapter } from "./types.ts";

// Bluesky の画面の作りを1箇所に集めてあるので、Bluesky 側の描き直しはここ1箇所
// の修正で済む。エクスポートしないのは、テストが与えるのはマークアップで、
// 読み取るのはこのファイルがそれに対して返す答えだから
// （utils/adapters/bluesky.test.ts）。
const BLUESKY_SELECTORS = Object.freeze({
  // testid には作者のハンドルが入る（"feedItem-by-bsky.app"）ので、前方一致で
  // 拾う。フィード・プロフィール・通知は前者、投稿詳細の画面は後者。
  postCard:
    '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]',
  reactionButton: '[data-testid="likeBtn"]',
  postLink: 'a[href*="/post/"]',
  // button の下にあること＝これが、投稿自身の画像と、外部リンクカードの
  // サムネイル（そちらは <a> の下にある）を分けている。
  image: 'button img[src*="/img/feed_thumbnail/"]',
  // 再生前の動画には <video> 要素が無い＝サムネイルは CSS の背景画像として
  // 描かれている。<video> が現れるのは再生を始めてから。
  video: '[style*="video.bsky.app"]',
  // GIF は Bluesky のメディアではなく外部埋め込みとして届く。
  animatedImage: 'video[src*="t.gifs.bsky.app"]',
  contentHider: '[data-testid="contentHider-post"]',
  userAvatar: '[data-testid="userAvatarImage"]',
  profileLink: 'a[href^="/profile/"]',
  homeTab: '[data-testid^="homeScreenFeedTabs-selector-"]',
  selectedTabMark: '[style*="background-color"]',
  postsFeed: '[data-testid="postsFeed-flatlist"]',
});

const BLUESKY_POST_ID = /\/profile\/([^/]+)\/post\/([^/?#]+)/;
const BLUESKY_FEED_END_TEXT = /^(?:End of feed|フィードの終わり)$/;

export function isBlueskySupportedHomeTimeline(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll(BLUESKY_SELECTORS.homeTab)).some(
    (tab) => Boolean(tab.querySelector(BLUESKY_SELECTORS.selectedTabMark)),
  );
}

// 通知画面は、投稿ではない行（いいね・フォロー）にも投稿カードの testid を
// 使い回す。そういう行はいいねボタンを持たない＝これが、投稿なら必ず持ち通知の
// 行は持たない唯一の部分。
function readablePostCards(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(BLUESKY_SELECTORS.postCard)).filter(
    (postCard) => postCard.querySelector(BLUESKY_SELECTORS.reactionButton),
  );
}

// `:` の注釈ではなく `satisfies`。理由は x.ts を参照。
export const blueskyAdapter = Object.freeze({
  id: "bluesky",
  matches: Object.freeze(["https://bsky.app/*"]),
  settingsKey: "bluesky",
  needsLayoutProbeForPagination: true,

  readTimelineKey(
    root: ParentNode,
    page: Pick<Location, "pathname" | "search">,
  ) {
    // 投稿詳細では、戻り先の一覧の位置を保持する。
    if (/^\/profile\/[^/]+\/post\/[^/]+\/?$/.test(page.pathname)) return null;
    if (!this.isTimelineAvailable(root, page)) return null;
    if (page.pathname !== "/") return `${page.pathname}${page.search}`;
    const tab = Array.from(
      root.querySelectorAll(BLUESKY_SELECTORS.homeTab),
    ).find((item) => item.querySelector(BLUESKY_SELECTORS.selectedTabMark));
    return `${page.pathname}${page.search}:${tab?.getAttribute("data-testid") ?? ""}:${tab?.textContent ?? ""}`;
  },

  hasReachedTimelineEnd(root: ParentNode) {
    const feed = root.querySelector(BLUESKY_SELECTORS.postsFeed);
    if (!feed) {
      return false;
    }

    return Array.from(feed.querySelectorAll('div[dir="auto"]')).some((item) =>
      BLUESKY_FEED_END_TEXT.test(item.textContent?.trim() ?? ""),
    );
  },

  getPostCards(root: ParentNode) {
    return readablePostCards(root);
  },

  hasPostCards(root: ParentNode) {
    return readablePostCards(root).length > 0;
  },

  isTimelineAvailable(root: ParentNode, page: Pick<Location, "pathname">) {
    return page.pathname === "/"
      ? isBlueskySupportedHomeTimeline(root)
      : this.hasPostCards(root);
  },

  // 隠される単位。X と違い Bluesky は区切り線と余白をカードの内側に持つので、
  // 外側のセルを探しに行く必要が無い。
  findPostCell(postCard: Element) {
    return postCard;
  },

  readPostId(postCard: Element) {
    for (const link of postCard.querySelectorAll(BLUESKY_SELECTORS.postLink)) {
      const match = BLUESKY_POST_ID.exec(link.getAttribute("href") ?? "");
      if (match) {
        return `${match[1]}:${match[2]}`;
      }
    }
    return null;
  },

  readMetricCount(postCard: Element) {
    const button = postCard.querySelector(BLUESKY_SELECTORS.reactionButton);
    if (!button) {
      return 0;
    }

    // 正確な数を持っているのは読み上げ用のラベル。ボタンの隣に出ている文字は
    // 丸められていて（「6万」）、どのしきい値とも比べようがない。
    return parseMetric(button.getAttribute("aria-label") || "");
  },

  // 画像と動画は別々に返す＝どちらをメディアと数えるかは利用者の設定であって、
  // このサービスの作りの話ではない。
  readMedia(postCard: Element) {
    return {
      hasImage: Boolean(postCard.querySelector(BLUESKY_SELECTORS.image)),
      hasVideo: Boolean(
        postCard.querySelector(BLUESKY_SELECTORS.video) ||
          postCard.querySelector(BLUESKY_SELECTORS.animatedImage),
      ),
    };
  },

  readIsReply(postCard: Element) {
    // フィード内の返信は親投稿からつながる縦線を左端の42px幅の列に持つ。
    // 文言は出ないため、現行Web版が描くこの構造で区別する。
    return Array.from(
      postCard.querySelectorAll('div[style*="width: 42px"]'),
    ).some((column) =>
      Array.from(column.children).some((child) => {
        const style = child.getAttribute("style") ?? "";
        return (
          style.includes("background-color") && style.includes("margin-bottom")
        );
      }),
    );
  },

  readIsQuote(postCard: Element) {
    const content = postCard.querySelector(BLUESKY_SELECTORS.contentHider);
    if (!content) {
      return false;
    }

    // 引用カードはリンクの役割を持つ div で、引用元のアバターを内包する。
    // 外部リンクカードは a 要素なので、サムネイル付きリンクとは混同しない。
    return Array.from(content.querySelectorAll('div[role="link"]')).some(
      (link) => Boolean(link.querySelector(BLUESKY_SELECTORS.userAvatar)),
    );
  },

  // リポストには testid も安定した文言も付かない＝ヘッダは読者の言語で
  // 「◯◯がリポスト」と出る。言語をまたいで変わらないのは作りの方で、リポストの
  // ヘッダのプロフィールリンクはアイコンを包み、作者のプロフィールリンクは
  // アバター画像を包む。
  readIsRepost(postCard: Element) {
    const profileLink = postCard.querySelector(BLUESKY_SELECTORS.profileLink);
    if (!profileLink || profileLink.querySelector("img")) {
      return false;
    }

    const firstChild = profileLink.firstElementChild;
    return firstChild?.tagName?.toLowerCase() === "svg";
  },
}) satisfies ServiceAdapter;
