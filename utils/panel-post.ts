export const POST_COLLECTION_LIMIT = 1_000;

export interface PanelPost {
  readonly id: string;
  readonly url: string;
  readonly author: string;
  readonly handle: string;
  readonly text: string;
  readonly images: readonly { readonly url: string; readonly alt: string }[];
  readonly metricCount: number | null;
}

export interface CollectedPost extends PanelPost {
  readonly hasImage: boolean;
  readonly hasVideo: boolean;
  readonly isReply: boolean;
  readonly isQuote: boolean;
  readonly isRepost: boolean;
}

export function canonicalPostUrl(
  value: string,
  site: "x" | "bluesky",
): string | null {
  if (value.length > 2_048) return null;
  try {
    const url = new URL(
      value,
      site === "x" ? "https://x.com" : "https://bsky.app",
    );
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    if (site === "x") {
      if (url.hostname !== "x.com" && url.hostname !== "twitter.com")
        return null;
      const match =
        /^\/(\w{1,15}|i\/web)\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/.exec(
          url.pathname,
        );
      return match ? `https://x.com/${match[1]}/status/${match[2]}` : null;
    }
    if (url.hostname !== "bsky.app") return null;
    const match = /^\/profile\/([\w.:-]+)\/post\/([\w.~:-]+)\/?$/.exec(
      url.pathname,
    );
    return match
      ? `https://bsky.app/profile/${match[1]}/post/${match[2]}`
      : null;
  } catch {
    return null;
  }
}

export function isPanelImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === "pbs.twimg.com" &&
        url.pathname.startsWith("/media/")) ||
        (url.hostname === "cdn.bsky.app" &&
          /^\/img\/feed_(?:thumbnail|fullsize)\//.test(url.pathname)))
    );
  } catch {
    return false;
  }
}

export function postText(
  value: string | null | undefined,
  limit: number,
): string {
  return (value ?? "").trim().slice(0, limit);
}

export function postMetric(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function postImages(
  images: Iterable<HTMLImageElement>,
): PanelPost["images"] {
  const result: { url: string; alt: string }[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const url = image.currentSrc || image.getAttribute("src");
    if (!isPanelImageUrl(url) || seen.has(url)) continue;
    seen.add(url);
    result.push({ url, alt: postText(image.getAttribute("alt"), 500) });
    if (result.length === 4) break;
  }
  return result;
}

export function isPanelPost(value: unknown): value is PanelPost {
  if (typeof value !== "object" || value === null) return false;
  const post = value as Partial<PanelPost>;
  if (typeof post.url !== "string" || post.url.length > 2_048) return false;
  if (
    canonicalPostUrl(post.url, "x") !== post.url &&
    canonicalPostUrl(post.url, "bluesky") !== post.url
  )
    return false;
  return (
    typeof post.id === "string" &&
    post.id.length > 0 &&
    post.id.length <= 1_000 &&
    typeof post.author === "string" &&
    post.author.length <= 100 &&
    typeof post.handle === "string" &&
    post.handle.length <= 100 &&
    typeof post.text === "string" &&
    post.text.length <= 500 &&
    (post.metricCount === null ||
      (Number.isSafeInteger(post.metricCount) &&
        (post.metricCount ?? -1) >= 0)) &&
    Array.isArray(post.images) &&
    post.images.length <= 4 &&
    post.images.every(
      (image) =>
        typeof image === "object" &&
        image !== null &&
        isPanelImageUrl(image.url) &&
        typeof image.alt === "string" &&
        image.alt.length <= 500,
    )
  );
}
