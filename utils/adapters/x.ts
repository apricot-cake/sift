// X（x.com / twitter.com）。このファイルにあるのは全部 X の画面の作り＝どの
// 要素が投稿で、判定の入力がそれぞれどこに書かれているか。判定そのものは
// filter-core.ts にあり、全サービスで共有している。
import { parseMetric } from "../filter-core.ts";
import type { ServiceAdapter } from "./types.ts";

// X の画面の作りを1箇所に集めてあるので、X 側の描き直しはここ1箇所の修正で
// 済む。エクスポートしないのは、テストが与えるのはマークアップで、読み取るのは
// このファイルがそれに対して返す答えだから（utils/adapters/x.test.ts）。
const X_SELECTORS = Object.freeze({
  postCard: 'article[data-testid="tweet"]',
  postCell: '[data-testid="cellInnerDiv"]',
  reactionButton: 'button[data-testid="like"], button[data-testid="unlike"]',
  statusTime: "time[datetime]",
  image: '[data-testid="tweetPhoto"], a[href*="/photo/"]',
  video:
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], video, a[href*="/video/"]',
  replyContent:
    '[data-testid="tweetText"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="card.wrapper"]',
  userName: '[data-testid="User-Name"]',
  socialContext: '[data-testid="socialContext"]',
  homeTabs: '[data-testid="ScrollSnap-List"][role="tablist"]',
  homeTab: '[role="tab"]',
});
const X_STATUS_ID = /\/status\/(\d+)/;

function timelinePostCards(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(X_SELECTORS.postCard)).filter(
    (postCard) =>
      postCard.parentElement?.closest(X_SELECTORS.postCard) === null,
  );
}

function directChildUnder(ancestor: Element, descendant: Element): Element {
  let child = descendant;
  while (child.parentElement && child.parentElement !== ancestor) {
    child = child.parentElement;
  }
  return child;
}

function lowestSharedAncestor(
  first: Element,
  second: Element,
  boundary: Element,
): Element | null {
  let ancestor = first.parentElement;
  while (ancestor && boundary.contains(ancestor)) {
    if (ancestor.contains(second)) {
      return ancestor;
    }
    if (ancestor === boundary) {
      break;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

// Home の先頭はプラットフォームが選ぶ「おすすめ」、2番目は「フォロー中」、
// それ以降は利用者がピン留めしたリスト。表示名はロケールやリスト名で変わるため、
// 順序と WAI-ARIA の選択状態だけで対象タイムラインかを読む。
export function isXSupportedHomeTimeline(root: ParentNode): boolean {
  const tabList = root.querySelector(X_SELECTORS.homeTabs);
  const tabs = Array.from(tabList?.querySelectorAll(X_SELECTORS.homeTab) ?? []);
  const selectedIndex = tabs.findIndex(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  return selectedIndex >= 1;
}

// `:` の注釈ではなく `satisfies` を使うのは、Object.freeze が保つリテラル型
// （`id` と `matches` の各要素）をリテラルのまま残すため＝注釈にすると
// インターフェース側の `string` / `readonly string[]` へ広がってしまう。
export const xAdapter = Object.freeze({
  id: "x",
  matches: Object.freeze(["https://x.com/*", "https://twitter.com/*"]),
  settingsKey: "x",

  readTimelineKey(
    root: ParentNode,
    page: Pick<Location, "pathname" | "search">,
  ) {
    // 狭い画面ではリスト選択などがタイムラインを置き換える。
    if (
      page.pathname.startsWith("/i/") &&
      !/^\/i\/lists\/\d+$/.test(page.pathname)
    ) {
      return null;
    }
    if (page.pathname === "/home" && !isXSupportedHomeTimeline(root)) {
      return null;
    }
    if (page.pathname !== "/home" && !this.hasPostCards(root)) {
      return null;
    }
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
    const selected = tabs.findIndex(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    return `${page.pathname}${page.search}:${selected}:${tabs[selected]?.textContent ?? ""}`;
  },

  getPostCards(root: ParentNode) {
    return timelinePostCards(root);
  },

  hasPostCards(root: ParentNode) {
    return timelinePostCards(root).length > 0;
  },

  // Home は投稿を仮想化していて、描き直し中は一時的にカードが無くなる。それでも
  // フォロー中とピン留めリストでは、投稿の描き直し中も抽出を受け付ける。
  // おすすめだけは対象外。固定 URL を持つリストの専用ページも従来どおり扱う。
  isTimelineAvailable(root: ParentNode, page: Pick<Location, "pathname">) {
    return page.pathname === "/home"
      ? isXSupportedHomeTimeline(root)
      : this.hasPostCards(root);
  },

  // 隠される単位。X は投稿を、区切り線と周囲の余白も持つセルで包んでいるので、
  // カードだけを隠すと隙間が残る。
  findPostCell(postCard: Element) {
    return postCard.closest(X_SELECTORS.postCell) || postCard;
  },

  readPostId(postCard: Element) {
    const statusTime = postCard.querySelector(X_SELECTORS.statusTime);
    const href = statusTime
      ?.closest('a[href*="/status/"]')
      ?.getAttribute("href");
    return X_STATUS_ID.exec(href ?? "")?.[1] ?? null;
  },

  readMetricCount(postCard: Element) {
    const button = postCard.querySelector(X_SELECTORS.reactionButton);
    if (!button) {
      return 0;
    }

    const accessibleText = button.getAttribute("aria-label") || "";
    const visibleText = (button.textContent ?? "").trim();
    return parseMetric(accessibleText || visibleText);
  },

  // 画像と動画は別々に返す＝どちらをメディアと数えるかは利用者の設定であって、
  // このサービスの作りの話ではない。
  readMedia(postCard: Element) {
    return {
      hasImage: Boolean(postCard.querySelector(X_SELECTORS.image)),
      hasVideo: Boolean(postCard.querySelector(X_SELECTORS.video)),
    };
  },

  readIsReply(postCard: Element) {
    const userName = postCard.querySelector(X_SELECTORS.userName);
    const content = Array.from(
      postCard.querySelectorAll(X_SELECTORS.replyContent),
    ).find((item) => item.closest(X_SELECTORS.postCard) === postCard);
    if (!userName || !content) {
      return false;
    }

    // 返信先は、投稿ヘッダーと最初の本文・画像・動画・リンクカードの間にある
    // 独立した行として描かれる。本文内のメンションは投稿内容側の枝に残るため、
    // プロフィールリンクの有無だけを見るより誤判定しにくい。
    const shared = lowestSharedAncestor(userName, content, postCard);
    if (!shared) {
      return false;
    }
    const headerBranch = directChildUnder(shared, userName);
    const contentBranch = directChildUnder(shared, content);
    const children = Array.from(shared.children);
    const headerIndex = children.indexOf(headerBranch);
    const contentIndex = children.indexOf(contentBranch);
    if (headerIndex < 0 || contentIndex <= headerIndex + 1) {
      return false;
    }
    return children
      .slice(headerIndex + 1, contentIndex)
      .some((child) => Boolean(child.querySelector('a[href^="/"]')));
  },

  readIsQuote(postCard: Element) {
    const ownId = this.readPostId(postCard);
    if (!ownId) {
      return false;
    }
    return Array.from(postCard.querySelectorAll('a[href*="/status/"]')).some(
      (link) => {
        const linkedId = X_STATUS_ID.exec(link.getAttribute("href") ?? "")?.[1];
        return Boolean(linkedId && linkedId !== ownId);
      },
    );
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
