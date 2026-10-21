export interface CompatibilityCase {
  id: string;
  site: "x" | "bluesky";
  start: string;
  destination: string;
  tab?: string;
  linkLabel?: string;
  linkHref?: string;
  linkHrefs?: readonly string[];
  list?: boolean;
  feed?: boolean;
}
// 同じ入口のケースを連続させる。ケース名と個別の期待値は変更しない。
export function groupByEntry<T>(
  targets: readonly T[],
  entry: (target: T) => string,
): T[] {
  const groups = new Map<string, T[]>();
  for (const target of targets) {
    const key = entry(target);
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }
  return [...groups.values()].flat();
}
export function compatibilityEntry(target: CompatibilityCase): string {
  return target.site === "x" && target.destination === "/search"
    ? `${new URL(target.start).origin}/search`
    : target.start;
}
export function unsupportedEntry(target: UnsupportedCase): string {
  const url = new URL(target.url);
  if (target.site === "x" && url.pathname === "/search")
    return url.origin + url.pathname;
  if (target.id === "unsupported-x-images")
    return (
      new URL(target.url).origin +
      new URL(target.url).pathname.replace(/\/media$/, "")
    );
  return target.url;
}
export const lifecycleCases = [
  { id: "transition-x", site: "x", url: "https://x.com/NASA" },
  {
    id: "transition-bluesky",
    site: "bluesky",
    url: "https://bsky.app/profile/bsky.app",
  },
] as const;
export const emptyCases = [{ id: "empty-x-search" }] as const;
export const lightboxCases = [
  { id: "lightbox-x", url: "https://x.com/NASA" },
] as const;
export interface UnsupportedCase {
  id: string;
  site: "x" | "bluesky" | "none";
  url: string;
  label?: string;
  profileMedia?: boolean;
  tab?: string;
}
export const unsupportedCases: readonly UnsupportedCase[] = [
  {
    id: "unsupported-x-replies",
    site: "x",
    url: "https://x.com/NASA",
    label: "返信",
  },
  {
    id: "unsupported-x-videos",
    site: "x",
    url: "https://x.com/NASA",
    profileMedia: true,
  },
  {
    id: "unsupported-bluesky-replies",
    site: "bluesky",
    url: "https://bsky.app/profile/bsky.app",
    label: "返信",
  },
  {
    id: "unsupported-x-images",
    site: "x",
    url: "https://x.com/NASA/media",
  },
  {
    id: "unsupported-x-recommended",
    site: "x",
    url: "https://x.com/home",
    label: "おすすめ",
  },
  {
    id: "unsupported-x-search",
    site: "x",
    url: "https://x.com/search?q=%E3%82%A4%E3%83%A9%E3%82%B9%E3%83%88",
    label: "話題のポスト",
  },
  {
    id: "unsupported-bluesky-search",
    site: "bluesky",
    url: "https://bsky.app/search?q=%E7%8C%AB",
    label: "トップ",
  },
  {
    id: "unsupported-fanbox",
    site: "none",
    url: "https://official.fanbox.cc/posts",
  },
  {
    id: "unsupported-site",
    site: "none",
    url: "https://apricot-cake.github.io/sift/",
  },
];
export function requiredFilterEvidence(_target: CompatibilityCase): string[] {
  return [
    "minimum-filter",
    "media-filter",
    "reply-filter",
    "quote-filter",
    "repost-filter",
  ];
}
// 期待値は対応仕様から定義する。Siftの判定結果から作らない。
export const cases: CompatibilityCase[] = [
  {
    id: "x-following",
    site: "x",
    start: "https://x.com/home",
    destination: "/home",
    tab: "フォロー中",
  },
  {
    id: "x-pinned-list",
    site: "x",
    start: "https://x.com/home",
    destination: "/home",
    tab: "t",
  },
  {
    id: "x-search",
    site: "x",
    start: "https://x.com/search?q=%E3%82%A4%E3%83%A9%E3%82%B9%E3%83%88",
    destination: "/search",
    tab: "最新",
  },
  {
    id: "x-reply-representative",
    site: "x",
    start: "https://x.com/search?q=%E7%8C%AB%20filter%3Areplies",
    destination: "/search",
    tab: "最新",
  },
  {
    id: "x-list",
    site: "x",
    start: "https://x.com/mewmwemowmow/lists",
    destination: "/i/lists/2082750019069948060",
    linkLabel: "e",
    list: true,
  },
  {
    id: "x-profile",
    site: "x",
    start: "https://x.com/NASA",
    destination: "/NASA",
    tab: "ポスト",
  },
  {
    id: "x-quote-representative",
    site: "x",
    start:
      "https://x.com/search?q=%E3%82%A4%E3%83%A9%E3%82%B9%E3%83%88%20filter%3Aquote",
    destination: "/search",
    tab: "最新",
  },
  {
    id: "bluesky-following",
    site: "bluesky",
    start: "https://bsky.app",
    destination: "/",
    tab: "フォロー中",
  },
  {
    id: "bluesky-pinned-list",
    site: "bluesky",
    start: "https://bsky.app",
    destination: "/",
    tab: "e",
  },
  {
    id: "bluesky-pinned-feed",
    site: "bluesky",
    start: "https://bsky.app",
    destination: "/",
    tab: "みつけよう",
  },
  {
    id: "bluesky-feed",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app/feed/whats-hot",
    destination: "/profile/bsky.app/feed/whats-hot",
    feed: true,
  },
  {
    id: "bluesky-profile",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app",
    destination: "/profile/bsky.app",
    tab: "投稿",
  },
  {
    id: "bluesky-media",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app",
    destination: "/profile/bsky.app",
    tab: "メディア",
  },
  {
    id: "bluesky-video",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app",
    destination: "/profile/bsky.app",
    tab: "ビデオ",
  },
  {
    id: "bluesky-list",
    site: "bluesky",
    start: "https://bsky.app",
    destination: "/profile/ruru-endpoint.bsky.social/lists/3kldrwhjefi2w",
    linkHrefs: [
      "/lists",
      "/profile/ruru-endpoint.bsky.social/lists/3kldrwhjefi2w",
    ],
    list: true,
  },
  {
    id: "bluesky-search",
    site: "bluesky",
    start: "https://bsky.app/search?q=%E7%8C%AB",
    destination: "/search",
    tab: "最新",
  },
];
