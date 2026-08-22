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
  postText: '[data-testid="postText"]',
  profileLink: 'a[href^="/profile/"]',
  followingTab: '[data-testid="homeScreenFeedTabs-selector-0"]',
  selectedTabMark: '[style*="background-color"]',
});

const BLUESKY_LIST_PATH = /^\/profile\/([^/]+)\/lists\/([^/]+)\/?$/;
const BLUESKY_FEED_PATH = /^\/profile\/([^/]+)\/feed\/([^/]+)\/?$/;

export function isBlueskyFollowingTimeline(root: ParentNode): boolean {
  return Boolean(
    root
      .querySelector(BLUESKY_SELECTORS.followingTab)
      ?.querySelector(BLUESKY_SELECTORS.selectedTabMark),
  );
}

// AT Protocol の record key は TID＝base32-sortable 13文字で 64bit の値を持ち、
// 上位53bit がマイクロ秒のタイムスタンプ、下位10bit が clock id。
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const TID_LENGTH = 13;
const TID_CLOCK_ID_BITS = 10n;
// record key は /post/ の次の区間であって末尾の区間ではない＝投稿詳細の画面で
// それを持つリンクは、その投稿自身の下位ページ（"/reposted-by"・"/quotes"・
// "/liked-by"）へのものだけになる。
const RECORD_KEY_IN_PATH = /\/post\/([^/?#]+)/;
// Bluesky にネットワーク自体より古い投稿は無いし、今より後の投稿も無い。TID
// ではないのにたまたまこの文字だけで綴られた record key は、この窓の外の値へ
// 復号される＝それが唯一の見分け方になる。下限だけでは捕まらない
// （"aaaaaaaaaaaaa" は西暦2190年へ復号される）。
const EARLIEST_PLAUSIBLE_MS = Date.parse("2022-01-01T00:00:00.000Z");
// サーバーと食い違う時計のための余裕で、それ以上ではない。少し未来に見える
// 投稿に対して classifyPost が置いているのと同じ許容。
const FUTURE_TOLERANCE_MS = 6 * 60 * 1000;

// 画面に出ている時刻が読めない投稿のための代替経路。復号だけを単体で試験できる
// ようにエクスポートしてある（偽の投稿を通してしか試せない状態にしない）。
//
// TID であることは公式クライアントの慣習であってプロトコルの保証ではないので、
// これは常に代替であって主たる読み方にはしない。
export function timestampFromRecordKey(
  href: unknown,
  nowMs = Date.now(),
): number {
  const recordKey = RECORD_KEY_IN_PATH.exec(String(href ?? ""))?.[1] ?? "";

  if (recordKey.length !== TID_LENGTH) {
    return Number.NaN;
  }

  let bits = 0n;
  for (const character of recordKey) {
    const value = TID_ALPHABET.indexOf(character);
    if (value < 0) {
      return Number.NaN;
    }
    bits = (bits << 5n) | BigInt(value);
  }

  const milliseconds = Number((bits >> TID_CLOCK_ID_BITS) / 1000n);
  const plausible =
    milliseconds >= EARLIEST_PLAUSIBLE_MS &&
    milliseconds <= nowMs + FUTURE_TOLERANCE_MS;
  return plausible ? milliseconds : Number.NaN;
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

  getPostCards(root: ParentNode) {
    return readablePostCards(root);
  },

  hasPostCards(root: ParentNode) {
    return readablePostCards(root).length > 0;
  },

  isTimelineAvailable(root: ParentNode, page: Pick<Location, "pathname">) {
    const selectedPage =
      page.pathname !== "/" || isBlueskyFollowingTimeline(root);
    return selectedPage && this.hasPostCards(root);
  },

  settingsScope(root: ParentNode, page: Pick<Location, "pathname">) {
    if (page.pathname === "/" && isBlueskyFollowingTimeline(root)) {
      return { key: "following", kind: "following" } as const;
    }
    const list = BLUESKY_LIST_PATH.exec(page.pathname);
    if (list) {
      return {
        key: `list:${list[1]}:${list[2]}`,
        kind: "list",
      } as const;
    }
    const feed = BLUESKY_FEED_PATH.exec(page.pathname);
    return feed
      ? ({ key: `feed:${feed[1]}:${feed[2]}`, kind: "feed" } as const)
      : null;
  },

  findEmptyStateContainer(root: ParentNode) {
    return root.querySelector<HTMLElement>('[data-testid="homeScreen"]');
  },

  // 隠される単位。X と違い Bluesky は区切り線と余白をカードの内側に持つので、
  // 外側のセルを探しに行く必要が無い。
  findPostCell(postCard: Element) {
    return postCard;
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

  // Bluesky は <time datetime> を書き出さない。あるのは、パーマリンクに付いた
  // ローカライズ済みの絶対時刻（Date.parse が受け付けるロケールとそうでない
  // ロケールがある）と、機械可読ではあるが慣習でしかない record key の2つ。
  //
  // 最初のリンクではなく、最初に読めたリンクを採る＝フィードの投稿は自分の
  // パーマリンクから始まるが、詳細画面が*対象にしている*投稿はパーマリンクを
  // 持たない（リンクの行き先がその投稿自身だから）ので、代わりに自分の下位
  // ページへのリンクから始まる。
  readCreatedAt(postCard: Element) {
    for (const link of postCard.querySelectorAll(BLUESKY_SELECTORS.postLink)) {
      const label = link.getAttribute("aria-label");
      const displayed = label ? Date.parse(label) : Number.NaN;
      if (Number.isFinite(displayed)) {
        return displayed;
      }

      const decoded = timestampFromRecordKey(link.getAttribute("href"));
      if (Number.isFinite(decoded)) {
        return decoded;
      }
    }

    return Number.NaN;
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

  readText(postCard: Element) {
    return Array.from(postCard.querySelectorAll(BLUESKY_SELECTORS.postText))
      .filter((text) => text.closest(BLUESKY_SELECTORS.postCard) === postCard)
      .map((text) => text.textContent ?? "")
      .join(" ");
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
