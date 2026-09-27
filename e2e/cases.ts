export interface CompatibilityCase {
  id: string;
  site: "youtube" | "niconico" | "x" | "bluesky";
  start: string;
  destination: string;
  tab?: string;
  linkLabel?: string;
  linkHref?: string;
  list?: boolean;
  sort?: "newest" | "popular";
  period: boolean;
  niconicoSort?: "投稿日時が新しい順" | "再生数が多い順";
  membersOnly?: boolean;
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
    url: "https://www.nicovideo.jp/user/129217273/video?sortKey=registeredAt&sortOrder=desc",
  },
  { id: "transition-x", site: "x", url: "https://x.com/uowata94" },
  {
    id: "transition-bluesky",
    site: "bluesky",
    url: "https://bsky.app/profile/bsky.app",
  },
] as const;

export const emptyCases = [{ id: "empty-x-search" }] as const;

export const unsupportedCases = [
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
  ...["投稿日時が古い順", "再生数が少ない順", "コメントが新しい順"].map(
    (label, index) => ({
      id: `unsupported-niconico-sort-${index}`,
      site: "niconico",
      url: "https://www.nicovideo.jp/user/129217273/video",
      label,
    }),
  ),
  {
    id: "unsupported-x-recommended",
    site: "x",
    url: "https://x.com/home",
    label: "おすすめ",
  },
  {
    id: "unsupported-x-search",
    site: "x",
    url: "https://x.com/search?q=cat",
    label: "話題のポスト",
  },
  {
    id: "unsupported-bluesky-search",
    site: "bluesky",
    url: "https://bsky.app/search?q=cat",
    label: "トップ",
  },
  {
    id: "unsupported-site",
    site: "none",
    url: "https://example.com/",
  },
] as const;

export function requiredFilterEvidence(target: CompatibilityCase): string[] {
  if (target.membersOnly) return ["members-filter"];
  if (target.site === "x" || target.site === "bluesky")
    return [
      "minimum-filter",
      "media-filter",
      "reply-filter",
      "quote-filter",
      "repost-filter",
    ];
  if (target.site === "niconico") return ["minimum-filter", "newer-filter"];
  return [
    target.period ? "period-filter" : "minimum-filter",
    "members-filter",
    ...(!target.period && !target.destination.endsWith("/shorts")
      ? ["newer-filter"]
      : []),
  ];
}

// 期待値は対応仕様から定義する。Siftの判定結果から作らない。
export const cases: CompatibilityCase[] = [
  {
    id: "youtube-members-representative",
    site: "youtube",
    start: "https://www.youtube.com/@sutehage_channel/videos",
    destination: "/@sutehage_channel/videos",
    sort: "newest",
    period: false,
    membersOnly: true,
  },
  ...(["videos", "shorts", "streams"] as const).flatMap((section) =>
    (["newest", "popular"] as const).map((sort) => ({
      id: `youtube-${section}-${sort}`,
      site: "youtube" as const,
      start: "https://www.youtube.com/@sutehage_channel",
      destination: `/@sutehage_channel/${section}`,
      tab:
        section === "videos"
          ? "動画"
          : section === "shorts"
            ? "ショート"
            : "ライブ",
      sort,
      period: section !== "shorts" && sort === "popular",
    })),
  ),
  {
    id: "youtube-chip-newest",
    site: "youtube",
    start: "https://www.youtube.com/@Google",
    destination: "/@Google/videos",
    tab: "動画",
    sort: "newest",
    period: false,
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
    id: "niconico-videos",
    site: "niconico",
    start: "https://www.nicovideo.jp/user/129217273",
    destination: "/user/129217273/video",
    tab: "動画・シリーズ",
    niconicoSort: "投稿日時が新しい順",
    period: false,
  },
  {
    id: "niconico-popular",
    site: "niconico",
    start: "https://www.nicovideo.jp/user/129217273",
    destination: "/user/129217273/video",
    tab: "動画・シリーズ",
    niconicoSort: "再生数が多い順",
    period: false,
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
    tab: "e",
    period: false,
  },
  {
    id: "x-search",
    site: "x",
    start: "https://x.com/search?q=cat",
    destination: "/search",
    tab: "最新",
    period: false,
  },
  {
    id: "x-list",
    site: "x",
    start: "https://x.com/ruaje8/lists",
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
    id: "bluesky-profile",
    site: "bluesky",
    start: "https://bsky.app/profile/bsky.app",
    destination: "/profile/bsky.app",
    tab: "投稿",
    period: false,
  },
  ...(
    [
      ["media", "メディア"],
      ["video", "ビデオ"],
    ] as const
  ).map(([section, tab]) => ({
    id: `bluesky-${section}`,
    site: "bluesky" as const,
    start: "https://bsky.app/profile/bsky.app",
    destination: "/profile/bsky.app",
    tab,
    period: false,
  })),
  {
    id: "bluesky-list",
    site: "bluesky",
    start: "https://bsky.app/lists",
    destination: "/profile/apricot-cake.com/lists/3kldrwhjefi2w",
    linkHref: "/profile/apricot-cake.com/lists/3kldrwhjefi2w",
    list: true,
    period: false,
  },
  {
    id: "bluesky-search",
    site: "bluesky",
    start: "https://bsky.app/search?q=cat",
    destination: "/search",
    tab: "最新",
    period: false,
  },
];
