// Bluesky（bsky.app）。このファイルにあるのは全部 Bluesky の画面の作り＝どの
// 要素が投稿で、判定の入力がそれぞれどこに書かれているか。判定そのものは
// filter-core.ts にあり、全サービスで共有している。
import { parseMetric } from "../filter-core.ts";
import {
  type CollectedPost,
  canonicalPostUrl,
  postImages,
  postMetric,
  postText,
} from "../panel-post.ts";
import { collectMetricCards } from "./metric-cards.ts";
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

// サイトが退避した画面・タブは読まない。
function hasHiddenAncestor(element: Element): boolean {
  let parent = element.parentElement;
  while (parent) {
    if (
      parent.hasAttribute("hidden") ||
      (parent as HTMLElement).style.display === "none"
    )
      return true;
    parent = parent.parentElement;
  }
  return false;
}

function selectedTab(root: ParentNode, selector: string): Element | undefined {
  return Array.from(root.querySelectorAll(selector)).find(
    (tab) =>
      !hasHiddenAncestor(tab) &&
      (tab.getAttribute("aria-selected") === "true" ||
        Boolean(tab.querySelector(BLUESKY_SELECTORS.selectedTabMark))),
  );
}

export function readBlueskyHomeSupport(root: ParentNode): boolean | null {
  // 固定リストとカスタムフィードは共通の画面なので、選択タブだけを読む。
  return selectedTab(root, BLUESKY_SELECTORS.homeTab) ? true : null;
}

export function isBlueskySupportedHomeTimeline(root: ParentNode): boolean {
  return readBlueskyHomeSupport(root) === true;
}

// 指標を取得できない投稿も診断対象に残す。通知だけの行は除く。
function readablePostCards(root: ParentNode): Element[] {
  const cards = new Set(root.querySelectorAll(BLUESKY_SELECTORS.postCard));
  // 検索結果は投稿testidを持たない。指標ボタンが欠けても投稿リンクから識別する。
  for (const card of root.querySelectorAll(
    '[data-testid="searchScreen"] div[role="link"]',
  )) {
    if (
      !card.parentElement?.closest('div[role="link"]') &&
      card.querySelector(BLUESKY_SELECTORS.postLink)
    )
      cards.add(card);
  }
  return Array.from(cards).filter(
    (postCard) =>
      !hasHiddenAncestor(postCard) &&
      (postCard.querySelector(BLUESKY_SELECTORS.reactionButton) ||
        postCard.querySelector(BLUESKY_SELECTORS.postLink)),
  );
}

function isOwnPostNode(postCard: Element, node: Element): boolean {
  let parent = node.parentElement;
  while (parent && parent !== postCard) {
    if (
      parent.matches(BLUESKY_SELECTORS.postCard) ||
      (parent.matches('div[role="link"]') &&
        (parent.querySelector(BLUESKY_SELECTORS.userAvatar) ||
          parent.querySelector(BLUESKY_SELECTORS.postLink)))
    )
      return false;
    parent = parent.parentElement;
  }
  return parent === postCard;
}

// `:` の注釈ではなく `satisfies`。理由は x.ts を参照。
export const blueskyAdapter = Object.freeze({
  id: "bluesky",
  matches: Object.freeze(["https://bsky.app/*"]),
  settingsKey: "bluesky",
  readPost(postCard: Element): CollectedPost | null {
    const link = Array.from(
      postCard.querySelectorAll(BLUESKY_SELECTORS.postLink),
    ).find((node) => isOwnPostNode(postCard, node));
    const href = link?.getAttribute("href");
    const url = href ? canonicalPostUrl(href, "bluesky") : null;
    if (!url) return null;
    const match = BLUESKY_POST_ID.exec(url);
    if (!match) return null;
    const id = `${match[1]}:${match[2]}`;
    if (id.length > 1_000) return null;
    const actor = match[1] ?? "";
    const names = Array.from(
      postCard.querySelectorAll(BLUESKY_SELECTORS.profileLink),
    )
      .filter(
        (node) =>
          isOwnPostNode(postCard, node) &&
          node.getAttribute("href")?.replace(/\/$/, "") === `/profile/${actor}`,
      )
      .map((node) => postText(node.textContent, 100))
      .filter(Boolean);
    const handle = names.find((name) => name.startsWith("@")) ?? `@${actor}`;
    const text = Array.from(
      postCard.querySelectorAll('[data-testid="postText"]'),
    ).find((node) => isOwnPostNode(postCard, node));
    const images = Array.from(
      postCard.querySelectorAll<HTMLImageElement>(BLUESKY_SELECTORS.image),
    ).filter((node) => isOwnPostNode(postCard, node));
    return {
      id,
      url,
      author: postText(
        names.find((name) => !name.startsWith("@")) ?? handle,
        100,
      ),
      handle: postText(handle, 100),
      text: postText(text?.textContent, 500),
      images: postImages(images),
      metricCount: postMetric(this.readMetricCount(postCard)),
      ...this.readMedia(postCard),
      isReply: this.readIsReply(postCard),
      isQuote: this.readIsQuote(postCard),
      isRepost: this.readIsRepost(postCard),
    };
  },
  readPageSupport(
    root: ParentNode,
    page: Pick<Location, "pathname"> & Partial<Pick<Location, "search">>,
  ) {
    if (page.pathname === "/") {
      const support = readBlueskyHomeSupport(root);
      return support === null
        ? "unknown"
        : support
          ? "supported"
          : "unsupported";
    }
    if (page.pathname === "/search") {
      const tab = selectedTab(
        root,
        '[data-testid="searchScreen"] [role="tab"]',
      );
      const label = tab?.textContent?.trim() ?? "";
      if (/^(最新|Latest)$/i.test(label)) return "supported";
      if (/^(トップ|Top|ユーザー|Users|People)$/i.test(label))
        return "unsupported";
      return "unknown";
    }
    return this.isTimelineAvailable(root, page) ? "supported" : "unsupported";
  },
  hasEmptyTimeline(root: ParentNode) {
    return [
      ...root.querySelectorAll(
        `${BLUESKY_SELECTORS.postsFeed} [dir="auto"], [data-testid="searchScreen"] [dir="auto"]`,
      ),
    ].some((e) =>
      /^(まだ投稿がありません|投稿がありません|検索結果がありません|No posts yet|No posts found|No results found)[。.!]?$/.test(
        e.textContent?.trim() ?? "",
      ),
    );
  },

  readTimelineKey(
    root: ParentNode,
    page: Pick<Location, "pathname" | "search">,
  ) {
    // 投稿詳細では、戻り先の一覧の位置を保持する。
    if (/^\/profile\/[^/]+\/post\/[^/]+\/?$/.test(page.pathname)) return null;
    if (!this.isTimelineAvailable(root, page)) return null;
    const tab = selectedTab(
      root,
      page.pathname === "/" ? BLUESKY_SELECTORS.homeTab : '[role="tab"]',
    );
    return `${page.pathname}${page.search}:${tab?.getAttribute("data-testid") ?? ""}:${tab?.textContent ?? ""}`;
  },

  getMetricPostCards(root: ParentNode, limit?: number) {
    return collectMetricCards(
      root,
      (element) => {
        const candidate =
          element.matches(BLUESKY_SELECTORS.postCard) ||
          (element.matches('[data-testid="searchScreen"] div[role="link"]') &&
            !element.parentElement?.closest('div[role="link"]') &&
            element.querySelector(BLUESKY_SELECTORS.postLink));
        return candidate &&
          !hasHiddenAncestor(element) &&
          (element.querySelector(BLUESKY_SELECTORS.reactionButton) ||
            element.querySelector(BLUESKY_SELECTORS.postLink))
          ? element
          : null;
      },
      undefined,
      100_000,
      limit,
    );
  },

  getPostCards(root: ParentNode) {
    return readablePostCards(root);
  },

  hasPostCards(root: ParentNode) {
    return readablePostCards(root).length > 0;
  },

  isTimelineAvailable(
    root: ParentNode,
    page: Pick<Location, "pathname"> & Partial<Pick<Location, "search">>,
  ) {
    if (page.pathname === "/") return isBlueskySupportedHomeTimeline(root);
    if (page.pathname === "/search") {
      const tab = selectedTab(
        root,
        '[data-testid="searchScreen"] [role="tab"]',
      );
      return /^(最新|Latest)$/i.test(tab?.textContent?.trim() ?? "");
    }
    const profileTab = selectedTab(
      root,
      '[data-testid^="profilePager-selector-"]',
    );
    if (
      profileTab &&
      !/^profilePager-selector-[023]$/.test(
        profileTab.getAttribute("data-testid") ?? "",
      )
    )
      return false;
    return /^\/profile\/[^/]+(?:\/(?:(?:lists|feed)\/[^/]+|media|video))?\/?$/.test(
      page.pathname,
    );
  },

  // 幅変更前後の位置は、区切り線と余白を含むカード自体を基準にする。
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
      return Number.NaN;
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
      (link) =>
        Boolean(
          link.querySelector(BLUESKY_SELECTORS.userAvatar) ||
            link.querySelector(BLUESKY_SELECTORS.postLink),
        ),
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
