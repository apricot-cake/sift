// The contract every per-service adapter satisfies. Held here rather than
// inferred from one adapter so x.ts, bluesky.ts and misskey.ts are checked
// against the same shape instead of each other.
import type { ThresholdKeys } from "../settings.ts";

export interface PostMedia {
  hasImage: boolean;
  hasVideo: boolean;
}

export interface ServiceAdapter {
  readonly id: string;
  // The match patterns the manifest registers for this service. Empty for a
  // service Sift is never registered for at build time — Misskey, whose hosts
  // the reader adds one at a time (utils/instances.ts).
  readonly matches: readonly string[];
  // The word this service uses for the reaction the thresholds count.
  readonly reactionLabel: string;
  // Which stored thresholds that reaction count is compared against.
  readonly thresholdKeys: ThresholdKeys;

  getPostCards(root: ParentNode): Element[];
  hasPostCards(root: ParentNode): boolean;
  // The unit that gets hidden — not always the post card itself.
  findPostCell(postCard: Element): Element;
  readReactionCount(postCard: Element): number;
  // NaN when the post's creation time cannot be read.
  readCreatedAt(postCard: Element): number;
  readMedia(postCard: Element): PostMedia;
  readIsRepost(postCard: Element): boolean;
}
