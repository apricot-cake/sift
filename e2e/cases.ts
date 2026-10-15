export interface CompatibilityCase {
  id: string;
  site: "youtube" | "niconico" | "x" | "bluesky";
  start: string;
  destination: string;
  tab?: string;
  linkLabel?: string;
  linkHref?: string;
  linkHrefs?: readonly string[];
  list?: boolean;
  feed?: boolean;
  sort?: "newest" | "popular" | "default";
  period: boolean;
  niconicoSort?: "投稿日時が新しい順" | "再生数が多い順";
  niconicoSearch?: "registeredAt" | "viewCount";
}

// 同じ入口のケースを連続させる。ケース名と個別の期待値は変更しない。
export function groupByEntry<T>(
  targets: readonly T[],
  entry: (target: T) => string,
  priority: (target: T) => number = () => 0,
): T[] {
  const groups = new Map<string, T[]>();
  for (const target of targets) {
    const key = entry(target);
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) =>
    group.sort((a, b) => priority(a) - priority(b)),
  );
}

export function liveCasePriority(id: string): number {
  if (id.includes("youtube") && id.includes("streams")) return 3;
  if (id.includes("youtube") && id.includes("shorts")) return 2;
  const searches: Record<string, number> = {
    "unsupported-niconico-search-newest": 1,
    "unsupported-niconico-search-oldest": 2,
    "unsupported-niconico-search-least-views": 3,
  };
  return searches[id] ?? 0;
}

export function compatibilityEntry(target: CompatibilityCase): string {
  return target.site === "x" && target.destination === "/search"
    ? new URL(target.start).origin + "/search"
    : target.start;
}

export function unsupportedEntry(target: UnsupportedCase): string {
  const url = new URL(target.url);
  if (target.site === "x" && url.pathname === "/search")
    return url.origin + url.pathname;
  if (target.site === "niconico" && url.pathname.startsWith("/search/"))
    return url.origin + url.pathname;
  if (target.site === "youtube" && (target.channelSearch || target.empty))
    return url.origin + url.pathname.replace(/\/(videos|search)$/, "/search");
  if (
    target.site === "niconico" &&
    /^\/user\/\d+\/video$/.test(new URL(target.url).pathname)
  )
    return (
      new URL(target.url).origin +
      new URL(target.url).pathname.replace(/\/video$/, "")
    );
  if (target.id === "unsupported-x-images")
    return (
      new URL(target.url).origin +
      new URL(target.url).pathname.replace(/\/media$/, "")
    );
  if (target.site === "youtube" && !target.channelSearch && !target.empty)
    return target.url.replace(/\/videos$/, "");
  return target.url;
}

export const lifecycleCases = [
  {
    id: "transition-youtube",
    site: "youtube",
    url: "https://www.youtube.com/@Google/videos",
  },
  {
    id: "transition-niconico",
    site: "niconico",
    url: "https://www.nicovideo.jp/user/129217273/video?sortKey=viewCount&sortOrder=desc",
  },
  { id: "transition-x", site: "x", url: "https://x.com/NASA" },
  {
    id: "transition-bluesky",
    site: "bluesky",
    url: "https://bsky.app/profile/bsky.app",
  },
] as const;

export const emptyCases = [{ id: "empty-x-search" }] as const;

// SPAでの切り替えに加え、直接URLを開いた初期状態を確認する代表ケース。
export const directInitializationCaseIds = [
  "unsupported-niconico-search-oldest",
  "unsupported-empty-youtube-channel-search",
] as const;

export const lightboxCases = [
  { id: "lightbox-x", url: "https://x.com/NASA" },
] as const;

export interface UnsupportedCase {
  id: string;
  site: "youtube" | "niconico" | "x" | "bluesky" | "none";
  url: string;
  label?: string;
  profileMedia?: boolean;
  tab?: string;
  sort?: "newest" | "popular" | "default";
  membersOnly?: boolean;
  channelSearch?: string;
  empty?: boolean;
}
export const unsupportedCases: readonly UnsupportedCase[] = [
  {
    id: "unsupported-niconico-search-default",
    site: "niconico",
    url: "https://www.nicovideo.jp/search/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF",
  },
  {
    id: "unsupported-niconico-search-oldest",
    site: "niconico",
    url: "https://www.nicovideo.jp/search/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF?sort=registeredAt&order=asc",
  },
  {
    id: "unsupported-niconico-search-least-views",
    site: "niconico",
    url: "https://www.nicovideo.jp/search/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF?sort=viewCount&order=asc",
  },
  {
    id: "unsupported-niconico-tag",
    site: "niconico",
    url: "https://www.nicovideo.jp/tag/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF?sort=registeredAt&order=desc",
  },
  {
    id: "unsupported-x-replies",
    site: "x",
    url: "https://x.com/uowata94",
    label: "返信",
  },
  {
    id: "unsupported-x-videos",
    site: "x",
    url: "https://x.com/AdamasMC",
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
    url: "https://x.com/uowata94/media",
  },
  {
    id: "unsupported-youtube-oldest-dropdown",
    site: "youtube",
    url: "https://www.youtube.com/@sutehage_channel/videos",
  },
  {
    id: "unsupported-youtube-oldest-chip",
    site: "youtube",
    url: "https://www.youtube.com/@Google/videos",
  },
  {
    id: "unsupported-niconico-sort-0",
    site: "niconico",
    url: "https://www.nicovideo.jp/user/129217273/video",
    label: "投稿日時が古い順",
  },
  {
    id: "unsupported-niconico-sort-1",
    site: "niconico",
    url: "https://www.nicovideo.jp/user/129217273/video",
    label: "再生数が少ない順",
  },
  {
    id: "unsupported-niconico-sort-2",
    site: "niconico",
    url: "https://www.nicovideo.jp/user/129217273/video",
    label: "コメントが新しい順",
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
    url: "https://apricot-cake.com/",
  },
  {
    id: "unsupported-niconico-search-newest",
    site: "niconico",
    url: "https://www.nicovideo.jp/search/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF?sort=registeredAt&order=desc",
  },
  {
    id: "unsupported-youtube-videos-without-sort",
    site: "youtube",
    url: "https://www.youtube.com/@SAYOSAYOCh/videos",
    sort: "default",
  },
  {
    id: "unsupported-youtube-channel-search",
    site: "youtube",
    url: "https://www.youtube.com/@zunda_drop/videos",
    channelSearch: "WARDOGS",
  },
  {
    id: "unsupported-youtube-members-representative",
    site: "youtube",
    url: "https://www.youtube.com/@sutehage_channel/videos",
    sort: "newest",
    membersOnly: true,
  },
  {
    id: "unsupported-youtube-videos-newest",
    site: "youtube",
    url: "https://www.youtube.com/@sutehage_channel",
    tab: "動画",
    sort: "newest",
  },
  {
    id: "unsupported-youtube-shorts-newest",
    site: "youtube",
    url: "https://www.youtube.com/@sutehage_channel",
    tab: "ショート",
    sort: "newest",
  },
  {
    id: "unsupported-youtube-shorts-popular",
    site: "youtube",
    url: "https://www.youtube.com/@sutehage_channel",
    tab: "ショート",
    sort: "popular",
  },
  {
    id: "unsupported-youtube-streams-newest",
    site: "youtube",
    url: "https://www.youtube.com/@sutehage_channel",
    tab: "ライブ",
    sort: "newest",
  },
  {
    id: "unsupported-youtube-chip-newest",
    site: "youtube",
    url: "https://www.youtube.com/@Google",
    tab: "動画",
    sort: "newest",
  },
  {
    id: "unsupported-niconico-videos",
    site: "niconico",
    url: "https://www.nicovideo.jp/user/129217273",
    tab: "動画・シリーズ",
  },
  {
    id: "unsupported-empty-youtube-channel-search",
    site: "youtube",
    url: "https://www.youtube.com/@zunda_drop/search?query=sift_empty_7d649d20",
    empty: true,
  },
];

export function requiredFilterEvidence(target: CompatibilityCase): string[] {
  if (target.site === "youtube" || target.site === "niconico")
    return ["period-filter"];
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
    id: "niconico-search-popular",
    site: "niconico",
    start:
      "https://www.nicovideo.jp/search/%E3%83%A1%E3%82%BA%E3%83%9E%E3%83%A9%E3%82%A4%E3%82%B6%E3%83%BC?sort=viewCount&order=desc",
    destination:
      "/search/%E3%83%A1%E3%82%BA%E3%83%9E%E3%83%A9%E3%82%A4%E3%82%B6%E3%83%BC",
    niconicoSearch: "viewCount",
    niconicoSort: "再生数が多い順",
    period: true,
  },
  {
    id: "youtube-videos-popular",
    site: "youtube",
    start: "https://www.youtube.com/@sutehage_channel",
    destination: "/@sutehage_channel/videos",
    tab: "動画",
    sort: "popular",
    period: true,
  },
  {
    id: "youtube-streams-popular",
    site: "youtube",
    start: "https://www.youtube.com/@sutehage_channel",
    destination: "/@sutehage_channel/streams",
    tab: "ライブ",
    sort: "popular",
    period: true,
  },
  {
    id: "youtube-chip-popular",
    site: "youtube",
    start: "https://www.youtube.com/@Google",
    destination: "/@Google/videos",
    tab: "動画",
    sort: "popular",
    period: true,
  },
  {
    id: "niconico-popular",
    site: "niconico",
    start: "https://www.nicovideo.jp/user/129217273",
    destination: "/user/129217273/video",
    tab: "動画・シリーズ",
    niconicoSort: "再生数が多い順",
    period: true,
  },
  {
    id: "niconico-period-representative",
    site: "niconico",
    start:
      "https://www.nicovideo.jp/user/53559097/video?sortKey=viewCount&sortOrder=desc",
    destination: "/user/53559097/video",
    niconicoSort: "再生数が多い順",
    period: true,
  },
  {
    id: "x-following",
    site: "x",
    start: "https://x.com/home",
    destination: "/home",
    tab: "フォロー中",
    period: false,
  },
  {
    id: "x-pinned-list",
    site: "x",
    start: "https://x.com/home",
    destination: "/home",
    tab: "t",
    period: false,
  },
  {
    id: "x-search",
    site: "x",
    start: "https://x.com/search?q=%E3%82%A4%E3%83%A9%E3%82%B9%E3%83%88",
    destination: "/search",
    tab: "最新",
    period: false,
  },
  {
    id: "x-reply-representative",
    site: "x",
    start: "https://x.com/search?q=%E7%8C%AB%20filter%3Areplies",
    destination: "/search",
    tab: "最新",
    period: false,
  },
  {
    id: "x-list",
    site: "x",
    start: "https://x.com/_apricot_cake_/lists",
    destination: "/i/lists/2082750019069948060",
    linkLabel: "e",
    list: true,
    period: false,
  },
  {
    id: "x-profile",
    site: "x",
    start: "https://x.com/uowata94",
    destination: "/uowata94",
    tab: "ポスト",
    period: false,
  },
  {
    id: "x-quote-representative",
    site: "x",
    start: "https://x.com/AdamasMC",
    destination: "/AdamasMC",
    tab: "ポスト",
    period: false,
  },
  {
    id: "bluesky-following",
    site: "bluesky",
    start: "https://bsky.app",
    destination: "/",
    tab: "フォロー中",
    period: false,
  },
  {
    id: "bluesky-pinned-list",
    site: "bluesky",
    start: "https://bsky.app",
    destination: "/",
    tab: "e",
    period: false,
  },
  {
    id: "bluesky-pinned-feed",
    site: "bluesky",
    start: "https://bsky.app",
    destination: "/",
    tab: "みつけよう",
    period: false,
  },
  {
    id: "bluesky-feed",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app/feed/whats-hot",
    destination: "/profile/bsky.app/feed/whats-hot",
    feed: true,
    period: false,
  },
  {
    id: "bluesky-profile",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app",
    destination: "/profile/bsky.app",
    tab: "投稿",
    period: false,
  },
  {
    id: "bluesky-media",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app",
    destination: "/profile/bsky.app",
    tab: "メディア",
    period: false,
  },
  {
    id: "bluesky-video",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app",
    destination: "/profile/bsky.app",
    tab: "ビデオ",
    period: false,
  },
  {
    id: "bluesky-list",
    site: "bluesky",
    start: "https://bsky.app",
    destination: "/profile/apricot-cake.com/lists/3kldrwhjefi2w",
    linkHrefs: ["/lists", "/profile/apricot-cake.com/lists/3kldrwhjefi2w"],
    list: true,
    period: false,
  },
  {
    id: "bluesky-search",
    site: "bluesky",
    start: "https://bsky.app/search?q=%E7%8C%AB",
    destination: "/search",
    tab: "最新",
    period: false,
  },
];
